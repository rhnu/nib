//! Fixed global configuration and one relocatable creation-data directory.

use std::{
    fs::{self, File, OpenOptions},
    io::Write as _,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use nib_app::{
    api::UserMessage,
    persistence::PersistenceError,
    settings::{GlobalSettingsStore, StorageBackend, StorageLocations},
};

const COPY_MARKER: &str = ".nib-copy-source";
const DATA_LOCK: &str = ".nib-data.lock";

struct ActiveData {
    directory: PathBuf,
    _lock: File,
}

/// The global lock prevents relocation while another host is using this configuration.
pub(crate) struct StorageManager {
    config_directory: PathBuf,
    default_data_directory: PathBuf,
    development: bool,
    restart_required: AtomicBool,
    pub(crate) settings: Arc<GlobalSettingsStore>,
    active: Mutex<Option<ActiveData>>,
    _lock: File,
}

impl StorageManager {
    pub(crate) fn open(base: &Path, development: bool) -> Result<Self, PersistenceError> {
        let config_directory = base.join("config");
        fs::create_dir_all(&config_directory).map_err(|error| {
            PersistenceError::failure("create the global configuration directory", error)
        })?;
        let lock = lock_directory(&config_directory.join(".nib.lock"))?;
        let settings_path = config_directory.join("settings.sqlite3");
        nib_app::migrations::upgrade_settings(&settings_path)?;
        let settings = Arc::new(GlobalSettingsStore::open(&settings_path)?);

        Ok(Self {
            config_directory: fs::canonicalize(&config_directory).map_err(|error| {
                PersistenceError::failure("resolve the configuration directory", error)
            })?,
            default_data_directory: base.join("data"),
            development,
            restart_required: AtomicBool::new(false),
            settings,
            active: Mutex::new(None),
            _lock: lock,
        })
    }

    /// Upgrades retained creation data while its directory is locked and workers have not started.
    pub(crate) fn upgrade_creation(&self) -> Result<(), PersistenceError> {
        nib_app::migrations::upgrade_creation(&self.data_directory()?.join("nib.sqlite3"))
    }

    /// Locks the selected creation-data directory before opening SQLite or media.
    pub(crate) fn data_directory(&self) -> Result<PathBuf, PersistenceError> {
        let mut active = self
            .active
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(active) = active.as_ref() {
            return Ok(active.directory.clone());
        }
        let directories = self.settings.directories()?;
        let source = directories
            .current
            .as_ref()
            .unwrap_or(&self.default_data_directory);
        if directories.current.is_some() && !source.is_dir() {
            return Err(invalid(UserMessage::DataDirectoryUnavailable));
        }
        fs::create_dir_all(source).map_err(|error| {
            PersistenceError::failure("create the creation-data directory", error)
        })?;
        let source = canonical_directory(source)?;
        let source_lock = lock_directory(&source.join(DATA_LOCK))?;
        self.settings.retain_current_directory(&source)?;
        let (directory, lock) = (source, source_lock);
        *active = Some(ActiveData {
            directory: directory.clone(),
            _lock: lock,
        });
        Ok(directory)
    }

    /// Copies only after the caller has stopped every data writer and drained generation.
    pub(crate) fn migrate_directory(
        &self,
        directory: Option<&Path>,
    ) -> Result<StorageLocations, PersistenceError> {
        let source = self.data_directory()?;
        let target =
            self.target_directory(directory.unwrap_or(&self.default_data_directory), &source)?;
        if same_path(&target, &source) {
            return self.locations();
        }
        let _target_lock = lock_directory(&target.join(DATA_LOCK))?;
        copy_data(&source, &target)?;
        verify_directory(&source, &target)?;
        if target.join("nib.sqlite3").is_file() {
            nib_app::persistence::SqliteDatabase::verify_copy(&target.join("nib.sqlite3"))?;
        }
        // Resolve every fallible display/read operation before publishing the new path.
        let mut locations = self.locations()?;
        locations.relocated_data_directory = Some(display_path(&target)?);
        locations.restart_required = true;
        self.settings.complete_directory_change(&target)?;
        self.restart_required.store(true, Ordering::Release);
        if let Err(error) = fs::remove_file(target.join(COPY_MARKER)) {
            tracing::warn!(error = ?error, "cannot remove completed relocation marker");
        }
        tracing::info!("creation data copied and verified; restart required");
        Ok(locations)
    }

    pub(crate) fn locations(&self) -> Result<StorageLocations, PersistenceError> {
        let active = self
            .active
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        let directories = self.settings.directories()?;
        let current = active
            .as_ref()
            .map(|active| &active.directory)
            .or(directories.current.as_ref())
            .unwrap_or(&self.default_data_directory);
        Ok(StorageLocations {
            config_directory: display_path(&self.config_directory)?,
            data_directory: display_path(current)?,
            relocated_data_directory: if self.restart_required.load(Ordering::Acquire) {
                directories
                    .current
                    .as_deref()
                    .map(display_path)
                    .transpose()?
            } else {
                None
            },
            default_data_directory: display_path(&self.default_data_directory)?,
            development: self.development,
            restart_required: self.restart_required.load(Ordering::Acquire),
        })
    }

    fn target_directory(
        &self,
        requested: &Path,
        source: &Path,
    ) -> Result<PathBuf, PersistenceError> {
        if !requested.is_absolute() {
            return Err(invalid(UserMessage::AbsoluteDirectoryRequired));
        }
        fs::create_dir_all(requested).map_err(|error| {
            PersistenceError::failure("create the selected data directory", error)
        })?;
        let target = canonical_directory(requested)?;
        validate_directory_relationship(&target, source, &self.config_directory)?;
        if same_path(&target, source) {
            return Ok(target);
        }
        let entries = fs::read_dir(&target).map_err(|error| {
            PersistenceError::failure("inspect the selected data directory", error)
        })?;
        let has_content = entries
            .map(|entry| entry.map(|entry| entry.file_name() != DATA_LOCK))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| PersistenceError::failure("read the selected data directory", error))?
            .into_iter()
            .any(|content| content);
        if has_content {
            let marker = match fs::read(target.join(COPY_MARKER)) {
                Ok(marker) => marker,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    return Err(invalid(UserMessage::EmptyDirectoryRequired));
                },
                Err(error) => {
                    return Err(PersistenceError::failure(
                        "read the interrupted relocation marker",
                        error,
                    ));
                },
            };
            let recorded: PathBuf = serde_json::from_slice(&marker).map_err(|error| {
                PersistenceError::failure("read the interrupted relocation source", error)
            })?;
            if !same_path(&recorded, source) {
                return Err(invalid(UserMessage::DirectoryBelongsToOtherData));
            }
        }
        Ok(target)
    }
}

impl StorageBackend for StorageManager {
    fn data_directory(&self) -> Result<PathBuf, PersistenceError> { Self::data_directory(self) }

    fn locations(&self) -> Result<StorageLocations, PersistenceError> { Self::locations(self) }

    fn migrate_directory(
        &self,
        directory: Option<&Path>,
    ) -> Result<StorageLocations, PersistenceError> {
        Self::migrate_directory(self, directory)
    }
}

fn canonical_directory(path: &Path) -> Result<PathBuf, PersistenceError> {
    fs::canonicalize(path)
        .map_err(|error| PersistenceError::failure("resolve a data directory", error))
}

fn lock_directory(path: &Path) -> Result<File, PersistenceError> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|error| PersistenceError::failure("open the storage lock", error))?;
    file.try_lock().map_err(|error| {
        PersistenceError::failure(
            "lock storage; close any other nib instance using this directory",
            error,
        )
    })?;
    Ok(file)
}

fn same_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        comparable_path(left)
            .as_os_str()
            .eq_ignore_ascii_case(comparable_path(right).as_os_str())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn contains_path(parent: &Path, child: &Path) -> bool {
    let parent = comparable_path(parent);
    let child = comparable_path(child);
    let mut child = child.components();
    parent.components().all(|part| {
        child
            .next()
            .is_some_and(|next| same_path(part.as_ref(), next.as_ref()))
    })
}

fn comparable_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        path.to_str()
            .map(readable_path)
            .map_or_else(|| path.to_owned(), PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        path.to_owned()
    }
}

fn validate_directory_relationship(
    target: &Path,
    source: &Path,
    config: &Path,
) -> Result<(), PersistenceError> {
    if contains_path(config, target) || contains_path(target, config) {
        return Err(invalid(UserMessage::DirectoryOverlapsConfig));
    }
    if !same_path(target, source)
        && (contains_path(source, target) || contains_path(target, source))
    {
        return Err(invalid(UserMessage::DirectoryContainsSource));
    }
    Ok(())
}

/// Keep the source intact until the user chooses to remove it after verification.
/// The marker allows a failed copy to be retried without accepting an arbitrary library.
fn copy_data(source: &Path, target: &Path) -> Result<(), PersistenceError> {
    let marker = target.join(COPY_MARKER);
    if !marker.exists() {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&marker)
            .map_err(|error| PersistenceError::failure("create the relocation marker", error))?;
        let content = serde_json::to_vec(source)
            .map_err(|error| PersistenceError::failure("encode the relocation source", error))?;
        file.write_all(&content)
            .and_then(|()| file.sync_all())
            .map_err(|error| PersistenceError::failure("retain the relocation marker", error))?;
    }
    // A cancelled failed copy may be retried after the source database changes.
    // Recovery files from an older copy must never be replayed against the new database.
    for suffix in ["-journal", "-wal", "-shm"] {
        let name = format!("nib.sqlite3{suffix}");
        if !source.join(&name).try_exists().map_err(|error| {
            PersistenceError::failure("inspect source SQLite recovery files", error)
        })? {
            match fs::remove_file(target.join(name)) {
                Ok(()) => {},
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
                Err(error) => {
                    return Err(PersistenceError::failure(
                        "remove a stale copied SQLite recovery file",
                        error,
                    ));
                },
            }
        }
    }
    copy_directory(source, target)
}

fn copy_directory(source: &Path, target: &Path) -> Result<(), PersistenceError> {
    for entry in fs::read_dir(source)
        .map_err(|error| PersistenceError::failure("read data for relocation", error))?
    {
        let entry = entry.map_err(|error| {
            PersistenceError::failure("read a data entry for relocation", error)
        })?;
        if entry.file_name() == DATA_LOCK || entry.file_name() == COPY_MARKER {
            continue;
        }
        let kind = entry
            .file_type()
            .map_err(|error| PersistenceError::failure("inspect relocation content", error))?;
        let destination = target.join(entry.file_name());
        match fs::symlink_metadata(&destination) {
            Ok(metadata) if metadata.is_symlink() || metadata.is_dir() != kind.is_dir() => {
                return Err(invalid(UserMessage::MigrationTargetMismatch));
            },
            Ok(_) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => {
                return Err(PersistenceError::failure(
                    "inspect the relocation destination",
                    error,
                ));
            },
        }
        if kind.is_dir() {
            fs::create_dir_all(&destination).map_err(|error| {
                PersistenceError::failure("create a relocated data folder", error)
            })?;
            copy_directory(&entry.path(), &destination)?;
        } else if kind.is_file() {
            let mut input = File::open(entry.path()).map_err(|error| {
                PersistenceError::failure("read retained creation data for relocation", error)
            })?;
            let mut output = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(&destination)
                .map_err(|error| {
                    PersistenceError::failure("create a relocated data file", error)
                })?;
            std::io::copy(&mut input, &mut output)
                .and_then(|_| output.sync_all())
                .map_err(|error| {
                    PersistenceError::failure("copy and sync retained creation data", error)
                })?;
        } else {
            return Err(invalid(UserMessage::MigrationUnsupportedFile));
        }
    }
    Ok(())
}

/// Compares every copied byte before publishing the destination as the next active directory.
fn verify_directory(source: &Path, target: &Path) -> Result<(), PersistenceError> {
    use std::io::Read as _;
    for entry in fs::read_dir(source)
        .map_err(|error| PersistenceError::failure("verify relocation source", error))?
    {
        let entry =
            entry.map_err(|error| PersistenceError::failure("verify relocation entry", error))?;
        if entry.file_name() == DATA_LOCK || entry.file_name() == COPY_MARKER {
            continue;
        }
        let destination = target.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|error| PersistenceError::failure("verify relocated type", error))?
            .is_dir()
        {
            verify_directory(&entry.path(), &destination)?;
            continue;
        }
        let mut input = File::open(entry.path())
            .map_err(|error| PersistenceError::failure("verify source data", error))?;
        let mut output = File::open(&destination)
            .map_err(|error| PersistenceError::failure("verify copied data", error))?;
        let mut remaining = input
            .metadata()
            .map_err(|error| {
                PersistenceError::failure("inspect source verification length", error)
            })?
            .len();
        if output
            .metadata()
            .map_err(|error| {
                PersistenceError::failure("inspect copied verification length", error)
            })?
            .len()
            != remaining
        {
            return Err(invalid(UserMessage::CopiedFileLengthMismatch));
        }
        let mut left = vec![0_u8; 65536];
        let mut right = vec![0_u8; 65536];
        while remaining > 0 {
            let length = usize::try_from(remaining.min(65536)).map_err(|error| {
                PersistenceError::failure("represent the verification chunk length", error)
            })?;
            input.read_exact(&mut left[..length]).map_err(|error| {
                PersistenceError::failure("read source verification data", error)
            })?;
            output.read_exact(&mut right[..length]).map_err(|error| {
                PersistenceError::failure("read copied verification data", error)
            })?;
            if left[..length] != right[..length] {
                return Err(invalid(UserMessage::CopiedFileContentMismatch));
            }
            remaining = remaining.saturating_sub(65536);
        }
    }
    Ok(())
}

fn display_path(path: &Path) -> Result<String, PersistenceError> {
    let value = path
        .to_str()
        .ok_or_else(|| invalid(UserMessage::NonUnicodeDirectory))?;
    Ok(readable_path(value))
}

fn readable_path(value: &str) -> String {
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(value).to_owned()
    }
}

fn invalid(message: UserMessage) -> PersistenceError { PersistenceError::InvalidData { message } }

#[cfg(test)]
mod tests;

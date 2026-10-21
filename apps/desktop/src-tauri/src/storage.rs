//! Fixed global configuration and one relocatable creation-data directory.

use std::{
    fs::{self, File, OpenOptions},
    io::Write as _,
    path::{Path, PathBuf},
    sync::Mutex,
};

use nib_app::{
    persistence::PersistenceError,
    settings::{GlobalSettingsStore, StorageLocations},
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
    startup_pending: Option<PathBuf>,
    pub(crate) settings: GlobalSettingsStore,
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
        let settings = GlobalSettingsStore::open(&config_directory.join("settings.sqlite3"))?;
        let startup_pending = settings.directories()?.pending;
        Ok(Self {
            config_directory: fs::canonicalize(&config_directory).map_err(|error| {
                PersistenceError::failure("resolve the configuration directory", error)
            })?,
            default_data_directory: base.join("data"),
            development,
            startup_pending,
            settings,
            active: Mutex::new(None),
            _lock: lock,
        })
    }

    /// Runs deferred relocation before opening SQLite or starting generation.
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
            return Err(invalid("数据目录不存在或不可访问，请恢复原目录后重试。"));
        }
        fs::create_dir_all(source).map_err(|error| {
            PersistenceError::failure("create the creation-data directory", error)
        })?;
        let source = canonical_directory(source)?;
        let source_lock = lock_directory(&source.join(DATA_LOCK))?;
        let pending = migration_target(
            self.startup_pending.as_deref(),
            directories.pending.as_deref(),
        );
        let (directory, lock) = if let Some(target) = pending {
            let target = self.target_directory(target, &source)?;
            let target_lock = lock_directory(&target.join(DATA_LOCK))?;
            copy_data(&source, &target)?;
            self.settings.complete_directory_change(&target)?;
            // A failed marker cleanup cannot invalidate the committed destination.
            if let Err(error) = fs::remove_file(target.join(COPY_MARKER)) {
                tracing::warn!(error = ?error, "cannot remove the completed relocation marker");
            }
            (target, target_lock)
        } else {
            self.settings.retain_current_directory(&source)?;
            (source, source_lock)
        };
        *active = Some(ActiveData {
            directory: directory.clone(),
            _lock: lock,
        });
        Ok(directory)
    }

    /// Scheduling a directory change never swaps a running database or worker.
    pub(crate) fn set_directory(
        &self,
        directory: Option<&Path>,
    ) -> Result<StorageLocations, PersistenceError> {
        let active = self
            .active
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        let directories = self.settings.directories()?;
        let source = active
            .as_ref()
            .map(|active| &active.directory)
            .or(directories.current.as_ref())
            .unwrap_or(&self.default_data_directory);
        let requested = directory.unwrap_or(&self.default_data_directory);
        if same_path(requested, source) {
            self.settings.set_pending_directory(None)?;
        } else {
            let source = if source.exists() {
                canonical_directory(source)?
            } else {
                source.clone()
            };
            let target = self.target_directory(requested, &source)?;
            if same_path(&target, &source) {
                self.settings.set_pending_directory(None)?;
            } else {
                self.settings.set_pending_directory(Some(&target))?;
            }
        }
        drop(active);
        self.locations()
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
            pending_data_directory: directories
                .pending
                .as_deref()
                .map(display_path)
                .transpose()?,
            default_data_directory: display_path(&self.default_data_directory)?,
            development: self.development,
        })
    }

    fn target_directory(
        &self,
        requested: &Path,
        source: &Path,
    ) -> Result<PathBuf, PersistenceError> {
        if !requested.is_absolute() {
            return Err(invalid("请选择绝对路径作为数据目录。"));
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
                    return Err(invalid("目标目录必须为空，不能打开其他已有的数据目录。"));
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
                return Err(invalid("目标目录属于另一份数据，请选择空目录。"));
            }
        }
        Ok(target)
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

fn migration_target<'a>(startup: Option<&Path>, pending: Option<&'a Path>) -> Option<&'a Path> {
    pending.filter(|pending| startup.is_some_and(|startup| same_path(startup, pending)))
}

fn validate_directory_relationship(
    target: &Path,
    source: &Path,
    config: &Path,
) -> Result<(), PersistenceError> {
    if contains_path(config, target) || contains_path(target, config) {
        return Err(invalid("数据目录不能与全局配置目录重叠。"));
    }
    if !same_path(target, source)
        && (contains_path(source, target) || contains_path(target, source))
    {
        return Err(invalid("新旧数据目录不能相互包含。"));
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
                return Err(invalid(
                    "迁移目标包含不匹配的文件或符号链接，请选择新的空目录。",
                ));
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
            return Err(invalid("数据目录含符号链接或不支持的文件，无法迁移。"));
        }
    }
    Ok(())
}

fn display_path(path: &Path) -> Result<String, PersistenceError> {
    let value = path
        .to_str()
        .ok_or_else(|| invalid("存储目录不能表示为 Unicode 路径。"))?;
    Ok(readable_path(value))
}

fn readable_path(value: &str) -> String {
    if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        value.strip_prefix(r"\\?\").unwrap_or(value).to_owned()
    }
}

fn invalid(message: &str) -> PersistenceError {
    PersistenceError::InvalidData {
        message: message.to_owned(),
    }
}

#[cfg(test)]
mod tests;

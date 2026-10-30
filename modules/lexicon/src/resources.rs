//! Immutable resource generations, resumable downloads and an atomic active pointer.

use std::{
    fs::{self, File, OpenOptions},
    io::{Read as _, Write as _},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex, RwLock,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use anyhow::{Context as _, Result, ensure};
use nib_app::lexicon::{
    LexiconError, LexiconInstallProgress, LexiconInstallState, LexiconQuery, LexiconSearch,
    LexiconSearchResult, LexiconStatus,
};
use reqwest::{blocking::Client, header};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use crate::{
    encoder::QueryEncoderPool,
    format::{ResourceFile, ResourceManifest, file_hash, hex_digest, valid_hash, verify_file},
    search::Snapshot,
};

#[derive(Serialize, Deserialize)]
struct InstalledPack {
    manifest: ResourceManifest,
    semantic: bool,
}

/// One machine-local store is independent of the movable creation database.
pub struct LexiconResources {
    directory: PathBuf,
    active: RwLock<Option<Arc<Snapshot>>>,
    progress: Mutex<Option<LexiconInstallProgress>>,
    installing: AtomicBool,
    cancelled: AtomicBool,
    encoder: Arc<QueryEncoderPool>,
}

impl LexiconResources {
    /// Open machine-local resources, retaining installation errors in the visible status.
    ///
    /// # Errors
    /// Returns an error if the resource root cannot be created.
    pub fn open(directory: &Path) -> Result<Self> {
        fs::create_dir_all(directory)?;
        let resources = Self {
            directory: directory.to_owned(),
            active: RwLock::new(None),
            progress: Mutex::new(None),
            installing: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
            encoder: Arc::default(),
        };
        if directory.join("active.json").exists() {
            match resources.read_active() {
                Ok(snapshot) => {
                    *resources
                        .active
                        .write()
                        .map_err(|_state| anyhow::anyhow!("resource lock poisoned"))? =
                        Some(Arc::new(snapshot));
                },
                Err(error) => {
                    tracing::error!(error=?error,"installed vocabulary could not be opened");
                    resources.update(
                        LexiconInstallState::Failed,
                        0,
                        0,
                        Some(format!("{error:#}")),
                    );
                },
            }
        }
        Ok(resources)
    }

    fn read_active(&self) -> Result<Snapshot> {
        let hash: String = serde_json::from_slice(&fs::read(self.directory.join("active.json"))?)?;
        ensure!(valid_hash(&hash), "invalid active resource identity");
        let directory = self.directory.join("packs").join(&hash);
        let installed: InstalledPack =
            serde_json::from_slice(&fs::read(directory.join(".nib-manifest.json"))?)?;
        installed.manifest.validate()?;
        for file in installed.manifest.files(installed.semantic) {
            verify_file(&directory, file)?;
        }
        Snapshot::open(
            &directory,
            installed.manifest,
            hash,
            installed.semantic,
            Arc::clone(&self.encoder),
        )
    }

    /// Claim the single download task before the host starts its worker.
    ///
    /// # Errors
    /// Returns an error if another installation is already in progress.
    pub fn begin_install(&self) -> Result<(), LexiconError> {
        self.installing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_state| {
                LexiconError::Invalid("a resource installation is already running".into())
            })?;
        self.cancelled.store(false, Ordering::Release);
        self.update(LexiconInstallState::Downloading, 0, 0, None);
        Ok(())
    }

    /// The host claims installation before scheduling this work on a blocking thread.
    pub fn install_prepared(&self, manifest_url: &str, semantic: bool) {
        let result = self.install(manifest_url, semantic);
        match result {
            Ok(()) => {
                let (completed, total) = self
                    .progress
                    .lock()
                    .ok()
                    .and_then(|progress| {
                        progress
                            .as_ref()
                            .map(|progress| (progress.completed_bytes, progress.total_bytes))
                    })
                    .unwrap_or((0, 0));
                self.update(LexiconInstallState::Complete, completed, total, None);
            },
            Err(error) => {
                let state = if self.cancelled.load(Ordering::Acquire) {
                    LexiconInstallState::Cancelled
                } else {
                    tracing::error!(error=?error,"vocabulary installation failed");
                    LexiconInstallState::Failed
                };
                self.update(state, 0, 0, Some(format!("{error:#}")));
            },
        }
        self.installing.store(false, Ordering::Release);
    }

    pub fn cancel_install(&self) { self.cancelled.store(true, Ordering::Release); }

    pub fn install_worker_failed(&self, message: String) {
        self.update(LexiconInstallState::Failed, 0, 0, Some(message));
        self.installing.store(false, Ordering::Release);
    }

    fn check_cancelled(&self) -> Result<()> {
        ensure!(
            !self.cancelled.load(Ordering::Acquire),
            "resource installation cancelled"
        );
        Ok(())
    }

    fn update(
        &self,
        state: LexiconInstallState,
        completed_bytes: u64,
        total_bytes: u64,
        message: Option<String>,
    ) {
        match self.progress.lock() {
            Ok(mut progress) => {
                *progress = Some(LexiconInstallProgress {
                    state,
                    completed_bytes,
                    total_bytes,
                    message,
                });
            },
            Err(error) => {
                tracing::error!(error=%error,"cannot update vocabulary installation status");
            },
        }
    }

    fn install(&self, manifest_url: &str, semantic: bool) -> Result<()> {
        let url = reqwest::Url::parse(manifest_url)?;
        ensure!(
            url.scheme() == "https" && url.username().is_empty() && url.password().is_none(),
            "manifest URL must use HTTPS without credentials"
        );
        let client = Client::builder()
            .https_only(true)
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(600))
            .build()?;
        let mut bytes = Vec::new();
        client
            .get(url)
            .send()?
            .error_for_status()?
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        ensure!(
            bytes.len() <= 2 * 1024 * 1024,
            "resource manifest exceeds size limit"
        );
        let manifest: ResourceManifest = serde_json::from_slice(&bytes)?;
        manifest.validate()?;
        ensure!(
            !semantic || manifest.semantic.is_some(),
            "this resource does not include semantic search"
        );
        let mut digest = Sha256::new();
        digest.update(&bytes);
        digest.update([u8::from(semantic)]);
        // Reinstallation creates a new immutable directory, including when repairing a
        // damaged generation whose SQLite handle is still open on Windows.
        digest.update(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos()
                .to_le_bytes(),
        );
        let hash = hex_digest(&digest.finalize());
        let directory = self.directory.join("packs").join(&hash);
        let objects = self.directory.join("objects");
        fs::create_dir_all(
            directory
                .parent()
                .context("resource generations parent missing")?,
        )?;
        fs::create_dir(&directory)?;
        fs::create_dir_all(&objects)?;
        let files = manifest.files(semantic);
        let total = files.iter().try_fold(0_u64, |sum, file| {
            sum.checked_add(file.bytes)
                .context("resource size overflow")
        })?;
        let mut completed = 0;
        for file in files {
            self.check_cancelled()?;
            self.download(&client, &objects, file, completed, total)?;
            let target = directory.join(&file.path);
            // SQLite opens without FILE_SHARE_DELETE on Windows. A generation must not
            // share the cache inode, otherwise repairing a corrupt cache cannot replace it.
            fs::copy(objects.join(&file.sha256), &target)?;
            completed += file.bytes;
            self.update(LexiconInstallState::Verifying, completed, total, None);
            verify_file(&directory, file)?;
        }
        self.check_cancelled()?;
        self.update(LexiconInstallState::Activating, completed, total, None);
        let snapshot = Snapshot::open(
            &directory,
            manifest.clone(),
            hash.clone(),
            semantic,
            Arc::clone(&self.encoder),
        )?;
        self.check_cancelled()?;
        atomic_write(
            &directory.join(".nib-manifest.json"),
            &serde_json::to_vec(&InstalledPack { manifest, semantic })?,
        )?;
        let mut active = self
            .active
            .write()
            .map_err(|_state| anyhow::anyhow!("resource lock poisoned"))?;
        atomic_write(
            &self.directory.join("active.json"),
            &serde_json::to_vec(&hash)?,
        )?;
        *active = Some(Arc::new(snapshot));
        tracing::info!(
            generation = hash,
            semantic,
            "activated vocabulary resources"
        );
        Ok(())
    }

    fn download(
        &self,
        client: &Client,
        objects: &Path,
        file: &ResourceFile,
        completed: u64,
        total: u64,
    ) -> Result<()> {
        let destination = objects.join(&file.sha256);
        if destination.exists()
            && destination.metadata()?.len() == file.bytes
            && file_hash(&destination)? == file.sha256
        {
            return Ok(());
        }
        let partial = objects.join(format!("{}.part", file.sha256));
        let etag_path = objects.join(format!("{}.etag", file.sha256));
        let offset = match partial.metadata() {
            Ok(metadata) => metadata.len(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
            Err(error) => return Err(error.into()),
        };
        let etag = match fs::read_to_string(&etag_path) {
            Ok(value) => Some(value),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        let resume = offset > 0
            && offset < file.bytes
            && etag.as_ref().is_some_and(|value| !value.starts_with("W/"));
        let mut request = client.get(&file.url);
        if resume {
            request = request
                .header(header::RANGE, format!("bytes={offset}-"))
                .header(
                    header::IF_RANGE,
                    etag.as_deref().context("resume ETag missing")?,
                );
        }
        let mut response = request.send()?.error_for_status()?;
        let append = resume && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        if append {
            let expected = format!("bytes {offset}-");
            ensure!(
                response
                    .headers()
                    .get(header::CONTENT_RANGE)
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|value| value.starts_with(&expected)
                        && value.ends_with(&format!("/{}", file.bytes))),
                "invalid partial resource response"
            );
        } else {
            ensure!(
                response.status() == reqwest::StatusCode::OK,
                "unexpected resource download response"
            );
        }
        if let Some(etag) = response.headers().get(header::ETAG) {
            fs::write(&etag_path, etag.as_bytes())?;
        }
        let mut output = OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&partial)?;
        let mut received = if append { offset } else { 0 };
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            self.check_cancelled()?;
            let count = response.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            received = received
                .checked_add(count as u64)
                .context("download length overflow")?;
            ensure!(
                received <= file.bytes,
                "download exceeds declared resource length"
            );
            output.write_all(&buffer[..count])?;
            self.update(
                LexiconInstallState::Downloading,
                completed + received,
                total,
                None,
            );
        }
        output.sync_all()?;
        drop(output);
        if received != file.bytes || file_hash(&partial)? != file.sha256 {
            fs::remove_file(&partial)?;
            anyhow::bail!("resource integrity mismatch for {}", file.path);
        }
        fs::rename(&partial, &destination)?;
        Ok(())
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let temporary = path.with_extension("tmp");
    let mut file = File::create(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, path)?;
    Ok(())
}

impl LexiconSearch for LexiconResources {
    fn search(&self, query: LexiconQuery) -> Result<LexiconSearchResult, LexiconError> {
        let snapshot = self
            .active
            .read()
            .map_err(|_state| LexiconError::Unavailable("resource lock poisoned".into()))?
            .clone();
        match snapshot {
            Some(snapshot) => snapshot
                .search(&query)
                .map_err(|error| LexiconError::Failure(error.into())),
            None => Ok(LexiconSearchResult {
                generation: None,
                matches: Vec::new(),
                semantic_available: false,
            }),
        }
    }

    fn status(&self) -> Result<LexiconStatus, LexiconError> {
        let active = self
            .active
            .read()
            .map_err(|_state| LexiconError::Unavailable("resource lock poisoned".into()))?;
        Ok(LexiconStatus {
            generation: active.as_ref().map(|snapshot| snapshot.generation.clone()),
            term_count: active.as_ref().map_or(0, |snapshot| snapshot.count),
            semantic_available: active
                .as_ref()
                .is_some_and(|snapshot| snapshot.semantic_available()),
            resource_directory: self.directory.to_string_lossy().into_owned(),
            install: self
                .progress
                .lock()
                .map_err(|_state| {
                    LexiconError::Unavailable("installation status lock poisoned".into())
                })?
                .clone(),
        })
    }
}

/// Verify a published candidate without downloading or initializing the model runtime.
///
/// # Errors
/// Returns an error for missing, corrupted or incompatible resource files.
pub fn verify_pack(directory: &Path) -> Result<ResourceManifest> {
    let manifest: ResourceManifest =
        serde_json::from_slice(&fs::read(directory.join("lexicon-manifest.json"))?)?;
    manifest.validate()?;
    for file in manifest.files(true) {
        verify_file(directory, file)?;
    }
    Snapshot::open(
        directory,
        manifest.clone(),
        manifest.id.clone(),
        manifest.semantic.is_some(),
        Arc::default(),
    )?;
    Ok(manifest)
}

/// Inspect a candidate using the same lexical and semantic search as the desktop application.
///
/// # Errors
/// Returns an error if verification, model initialization or the query fails.
pub fn query_pack(directory: &Path, query: &LexiconQuery) -> Result<LexiconSearchResult> {
    let manifest = verify_pack(directory)?;
    Snapshot::open(
        directory,
        manifest.clone(),
        manifest.id.clone(),
        manifest.semantic.is_some(),
        Arc::default(),
    )?
    .search(query)
}

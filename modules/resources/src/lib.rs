//! Resumable content downloads and immutable generations shared by resource consumers.

mod download;
mod error;
pub mod format;

use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read as _, Write as _},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use anyhow::{Context as _, Result, ensure};
pub use error::ResourceError;
use format::{
    CATALOG_URL, Catalog, CatalogResource, ResourceManifest, file_hash, hex_digest, valid_hash,
    verify_file,
};
use nib_contract::downloads::{
    DownloadProgress, DownloadState, DownloadStatus, DownloadableResourceStatus,
    ResourceComponentStatus,
};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

/// A prepared domain snapshot has no remaining fallible activation work.
pub trait PreparedResource: Send {
    fn activate(self: Box<Self>);
}

/// Domain consumers validate and open resources before the store publishes a generation.
pub trait ResourceConsumer: Send + Sync {
    /// Validate and open a generation without replacing the active domain snapshot.
    ///
    /// # Errors
    /// Returns a domain validation or opening error; the previous snapshot remains active.
    fn prepare(&self, generation: Arc<ResourceGeneration>) -> Result<Box<dyn PreparedResource>>;

    fn deactivate(&self);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstalledResource {
    resource: CatalogResource,
    manifest: ResourceManifest,
    components: Vec<String>,
    generation: String,
}

/// A lease keeps files alive while a domain snapshot or query is using them on Windows.
pub struct ResourceGeneration {
    pub directory: PathBuf,
    pub id: String,
    pub version: String,
    pub components: Vec<String>,
    pub generation: String,
    retired: AtomicBool,
}

impl Drop for ResourceGeneration {
    fn drop(&mut self) {
        if self.retired.load(Ordering::Acquire)
            && let Err(error) = fs::remove_dir_all(&self.directory)
        {
            tracing::warn!(path=%self.directory.display(),error=?error,"could not remove retired resource generation");
        }
    }
}

struct Installed {
    record: InstalledResource,
    lease: Arc<ResourceGeneration>,
}

#[derive(Default)]
struct State {
    catalog: Vec<(CatalogResource, ResourceManifest)>,
    catalog_error: Option<String>,
    installed: BTreeMap<String, Installed>,
    progress: BTreeMap<String, DownloadProgress>,
    task: Option<String>,
    task_manifest: Option<(CatalogResource, ResourceManifest, Vec<String>)>,
    cancelled: bool,
}

/// Machine-local resources do not move with the creation database.
pub struct ResourceStore {
    directory: PathBuf,
    state: Mutex<State>,
    consumers: BTreeMap<String, Arc<dyn ResourceConsumer>>,
    refreshing: Mutex<()>,
    cache: Mutex<()>,
}

impl ResourceStore {
    /// Create the local store and restore available installed resource snapshots.
    ///
    /// # Errors
    /// Returns an error if the resource directories cannot be created or shared state
    /// cannot be accessed. Invalid cached or installed metadata is reported in status.
    pub fn open(
        directory: &Path,
        consumers: BTreeMap<String, Arc<dyn ResourceConsumer>>,
    ) -> Result<Self, ResourceError> {
        Self::open_inner(directory, consumers).map_err(ResourceError::Failure)
    }

    fn open_inner(
        directory: &Path,
        consumers: BTreeMap<String, Arc<dyn ResourceConsumer>>,
    ) -> Result<Self> {
        fs::create_dir_all(directory.join("packs"))?;
        fs::create_dir_all(directory.join("objects"))?;
        let store = Self {
            directory: directory.to_owned(),
            state: Mutex::default(),
            consumers,
            refreshing: Mutex::new(()),
            cache: Mutex::new(()),
        };
        if directory.join("catalog.json").exists() {
            match store.read_cached_catalog() {
                Ok(catalog) => store.lock()?.catalog = catalog,
                Err(error) => store.lock()?.catalog_error = Some(format!("{error:#}")),
            }
        }
        if directory.join("active.json").exists() {
            let records = (|| -> Result<Vec<serde_json::Value>> {
                Ok(serde_json::from_slice(&fs::read(
                    directory.join("active.json"),
                )?)?)
            })();
            match records {
                Ok(records) => {
                    for value in records {
                        match serde_json::from_value::<InstalledResource>(value) {
                            Ok(record) => store.restore(record),
                            Err(error) => store.record_startup_error(format!(
                                "invalid installed resource record: {error}"
                            )),
                        }
                    }
                },
                Err(error) => store
                    .record_startup_error(format!("cannot read installed resources: {error:#}")),
            }
        }
        Ok(store)
    }

    fn record_startup_error(&self, message: String) {
        tracing::error!(
            error = message,
            "installed resource state could not be restored"
        );
        if let Ok(mut state) = self.lock() {
            state.catalog_error = Some(match state.catalog_error.take() {
                Some(previous) => format!("{previous}; {message}"),
                None => message,
            });
        }
    }

    fn restore(&self, record: InstalledResource) {
        let result = (|| -> Result<Arc<ResourceGeneration>> {
            validate_identity(&record.resource, &record.manifest)?;
            ensure!(
                valid_hash(&record.generation),
                "invalid installed generation"
            );
            ensure!(
                record.manifest.selection(&record.components)? == record.components,
                "invalid installed component selection"
            );
            let lease = Arc::new(ResourceGeneration {
                directory: self.directory.join("packs").join(&record.generation),
                id: record.manifest.id.clone(),
                version: record.manifest.version.clone(),
                components: record.components.clone(),
                generation: record.generation.clone(),
                retired: AtomicBool::new(false),
            });
            for file in record.manifest.files(&record.components) {
                verify_file(&lease.directory, file)?;
            }
            if let Some(consumer) = self.consumers.get(&record.manifest.id) {
                consumer.prepare(Arc::clone(&lease))?.activate();
            }
            Ok(lease)
        })();
        match result {
            Ok(lease) => {
                if let Ok(mut state) = self.lock() {
                    state
                        .installed
                        .insert(record.manifest.id.clone(), Installed { record, lease });
                }
            },
            Err(error) => {
                self.record_startup_error(format!("{}: {error:#}", record.manifest.id));
                // Retain valid metadata for offline repair, even when files or domain opening fail.
                if record.manifest.validate().is_ok() && valid_hash(&record.generation) {
                    let lease = Arc::new(ResourceGeneration {
                        directory: self.directory.join("packs").join(&record.generation),
                        id: record.manifest.id.clone(),
                        version: record.manifest.version.clone(),
                        components: record.components.clone(),
                        generation: record.generation.clone(),
                        retired: AtomicBool::new(false),
                    });
                    if let Ok(mut state) = self.lock() {
                        state.progress.insert(
                            record.manifest.id.clone(),
                            DownloadProgress {
                                components: record.components.clone(),
                                state: DownloadState::Failed,
                                completed_bytes: 0,
                                total_bytes: 0,
                                message: Some(format!("{error:#}")),
                            },
                        );
                        state
                            .installed
                            .insert(record.manifest.id.clone(), Installed { record, lease });
                    }
                }
            },
        }
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, State>> {
        self.state
            .lock()
            .map_err(|_poisoned| anyhow::anyhow!("resource state lock poisoned"))
    }

    fn client() -> Result<Client> {
        Ok(Client::builder()
            .https_only(true)
            .connect_timeout(Duration::from_secs(20))
            .timeout(Duration::from_secs(600))
            .build()?)
    }

    fn read_cached_catalog(&self) -> Result<Vec<(CatalogResource, ResourceManifest)>> {
        let catalog: Catalog =
            serde_json::from_slice(&fs::read(self.directory.join("catalog.json"))?)?;
        catalog.validate()?;
        catalog
            .resources
            .into_iter()
            .map(|resource| {
                let path = self
                    .directory
                    .join("objects")
                    .join(&resource.manifest.sha256);
                ensure!(
                    path.metadata()?.len() == resource.manifest.bytes
                        && file_hash(&path)? == resource.manifest.sha256,
                    "cached manifest integrity mismatch"
                );
                let manifest: ResourceManifest = serde_json::from_slice(&fs::read(path)?)?;
                validate_identity(&resource, &manifest)?;
                Ok((resource, manifest))
            })
            .collect()
    }

    /// Fetch the fixed catalog and its content-verified manifests, retaining installed groups offline.
    ///
    /// # Errors
    /// Returns an error if the catalog or shared state locks cannot be accessed.
    /// Network, parsing and file failures are retained in the returned catalog status.
    pub fn refresh_catalog(&self) -> Result<DownloadStatus, ResourceError> {
        let _refresh = self
            .refreshing
            .lock()
            .map_err(|_poisoned| anyhow::anyhow!("catalog lock poisoned"))?;
        let result = (|| {
            let client = Self::client()?;
            let mut bytes = Vec::new();
            client
                .get(CATALOG_URL)
                .send()?
                .error_for_status()?
                .take(2 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)?;
            ensure!(
                bytes.len() <= 2 * 1024 * 1024,
                "resource catalog exceeds size limit"
            );
            let catalog: Catalog = serde_json::from_slice(&bytes)?;
            catalog.validate()?;
            let mut entries = Vec::new();
            for resource in &catalog.resources {
                ensure!(
                    resource.manifest.bytes <= 2 * 1024 * 1024,
                    "resource manifest exceeds size limit"
                );
                // Catalog requests do not participate in a component installation or cancellation.
                self.download(&client, &resource.manifest, None, 0, 0)?;
                let manifest: ResourceManifest = serde_json::from_slice(&fs::read(
                    self.directory
                        .join("objects")
                        .join(&resource.manifest.sha256),
                )?)?;
                validate_identity(resource, &manifest)?;
                entries.push((resource.clone(), manifest));
            }
            atomic_write(&self.directory.join("catalog.json"), &bytes)?;
            Ok::<_, anyhow::Error>(entries)
        })();
        let mut state = self.lock()?;
        match result {
            Ok(entries) => {
                state.catalog = entries;
                state.catalog_error = None;
            },
            Err(error) => {
                tracing::warn!(error=?error,"resource catalog refresh failed");
                state.catalog_error = Some(format!("{error:#}"));
            },
        }
        drop(state);
        self.status()
    }

    /// Report catalog resources, installed versions and the latest installation progress.
    ///
    /// # Errors
    /// Returns an error if the shared resource state lock is poisoned.
    pub fn status(&self) -> Result<DownloadStatus, ResourceError> {
        let state = self.lock()?;
        let mut entries: BTreeMap<_, _> = state
            .catalog
            .iter()
            .map(|(resource, manifest)| (resource.id.clone(), (resource, manifest)))
            .collect();
        for (id, installed) in &state.installed {
            entries
                .entry(id.clone())
                .or_insert((&installed.record.resource, &installed.record.manifest));
        }
        let resources = entries
            .into_iter()
            .map(|(id, (resource, manifest))| {
                let installed = state.installed.get(&id);
                DownloadableResourceStatus {
                    id: id.clone(),
                    name: resource.name.clone(),
                    description: resource.description.clone(),
                    version: resource.version.clone(),
                    installed_version: installed
                        .map(|installed| installed.record.manifest.version.clone()),
                    components: manifest
                        .components
                        .iter()
                        .map(|component| ResourceComponentStatus {
                            id: component.id.clone(),
                            name: component.name.clone(),
                            description: component.description.clone(),
                            requires: component.requires.clone(),
                            bytes: component.files.iter().map(|file| file.bytes).sum(),
                            installed: installed.is_some_and(|installed| {
                                installed.record.components.contains(&component.id)
                            }),
                        })
                        .collect(),
                    install: state.progress.get(&id).cloned(),
                }
            })
            .collect();
        Ok(DownloadStatus {
            directory: self.directory.to_string_lossy().into_owned(),
            resources,
            catalog_error: state.catalog_error.clone(),
        })
    }

    /// Claim work before the host dispatches it, so cancellation cannot miss a queued task.
    ///
    /// # Errors
    /// Returns an error if state cannot be accessed, another task is running, the resource
    /// is absent from the catalog, or its component selection cannot be resolved.
    pub fn begin_install(&self, id: &str, components: &[String]) -> Result<(), ResourceError> {
        let mut state = self.lock()?;
        if state.task.is_some() {
            return Err(ResourceError::Conflict(
                "a resource installation is already running",
            ));
        }
        let (_, manifest) = state
            .catalog
            .iter()
            .find(|(resource, _)| resource.id == id)
            .ok_or_else(|| ResourceError::NotFound(id.to_owned()))?;
        let components = manifest
            .selection(components)
            .map_err(ResourceError::Invalid)?;
        state.task_manifest = state
            .catalog
            .iter()
            .find(|(resource, _)| resource.id == id)
            .map(|(resource, manifest)| (resource.clone(), manifest.clone(), components.clone()));
        state.task = Some(id.to_owned());
        state.cancelled = false;
        state.progress.insert(
            id.to_owned(),
            DownloadProgress {
                components,
                state: DownloadState::Downloading,
                completed_bytes: 0,
                total_bytes: 0,
                message: None,
            },
        );
        Ok(())
    }

    /// Request cancellation of the matching installation, including work waiting to run.
    ///
    /// # Errors
    /// Returns an error if the shared resource state lock is poisoned.
    pub fn cancel(&self, id: &str) -> Result<(), ResourceError> {
        let mut state = self.lock()?;
        if state.task.as_deref() == Some(id) {
            state.cancelled = true;
        }
        Ok(())
    }

    pub fn install_prepared(&self, id: &str) {
        let result = self.install(id);
        if let Ok(mut state) = self.lock() {
            let cancelled = state.cancelled;
            let progress = state
                .progress
                .entry(id.to_owned())
                .or_insert(DownloadProgress {
                    components: Vec::new(),
                    state: DownloadState::Failed,
                    completed_bytes: 0,
                    total_bytes: 0,
                    message: None,
                });
            match result {
                Ok(()) => {
                    progress.state = DownloadState::Complete;
                    progress.message = None;
                },
                Err(error) => {
                    if !cancelled {
                        tracing::error!(resource=id,error=?error,"resource installation failed");
                    }
                    progress.state = if cancelled {
                        DownloadState::Cancelled
                    } else {
                        DownloadState::Failed
                    };
                    progress.message = Some(format!("{error:#}"));
                },
            }
            state.task = None;
            state.task_manifest = None;
            state.cancelled = false;
        }
    }

    pub fn worker_failed(&self, id: &str, message: String) {
        if let Ok(mut state) = self.lock() {
            let components = state
                .progress
                .get(id)
                .map(|progress| progress.components.clone())
                .unwrap_or_default();
            state.progress.insert(
                id.to_owned(),
                DownloadProgress {
                    components,
                    state: DownloadState::Failed,
                    completed_bytes: 0,
                    total_bytes: 0,
                    message: Some(message),
                },
            );
            state.task = None;
            state.task_manifest = None;
            state.cancelled = false;
        }
    }

    fn check_cancelled(&self, id: &str) -> Result<()> {
        let state = self.lock()?;
        ensure!(
            state.task.as_deref() == Some(id) && !state.cancelled,
            "resource installation cancelled"
        );
        Ok(())
    }

    fn update(&self, id: &str, phase: DownloadState, completed: u64, total: u64) -> Result<()> {
        let mut state = self.lock()?;
        let components = state
            .progress
            .get(id)
            .map(|p| p.components.clone())
            .unwrap_or_default();
        state.progress.insert(
            id.to_owned(),
            DownloadProgress {
                components,
                state: phase,
                completed_bytes: completed,
                total_bytes: total,
                message: None,
            },
        );
        Ok(())
    }

    fn install(&self, id: &str) -> Result<()> {
        let (resource, manifest, selected) = self
            .lock()?
            .task_manifest
            .clone()
            .context("resource installation was not prepared")?;
        let mut digest = Sha256::new();
        digest.update(serde_json::to_vec(&manifest)?);
        digest.update(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos()
                .to_le_bytes(),
        );
        let generation = hex_digest(&digest.finalize());
        let directory = self.directory.join("packs").join(&generation);
        fs::create_dir(&directory)?;
        let lease = Arc::new(ResourceGeneration {
            directory,
            id: id.to_owned(),
            version: manifest.version.clone(),
            components: selected.clone(),
            generation: generation.clone(),
            retired: AtomicBool::new(true),
        });
        let client = Self::client()?;
        let total = manifest.files(&selected).try_fold(0_u64, |sum, file| {
            sum.checked_add(file.bytes)
                .context("resource size overflow")
        })?;
        let mut completed = 0;
        for file in manifest.files(&selected) {
            self.check_cancelled(id)?;
            self.download(&client, file, Some(id), completed, total)?;
            // Copy instead of linking: an open SQLite handle must not lock the cache inode.
            fs::copy(
                self.directory.join("objects").join(&file.sha256),
                lease.directory.join(&file.path),
            )?;
            completed += file.bytes;
            self.update(id, DownloadState::Verifying, completed, total)?;
            verify_file(&lease.directory, file)?;
        }
        self.check_cancelled(id)?;
        self.update(id, DownloadState::Activating, completed, total)?;
        let prepared = self
            .consumers
            .get(id)
            .map(|consumer| consumer.prepare(Arc::clone(&lease)))
            .transpose()?;
        let record = InstalledResource {
            resource,
            manifest,
            components: selected,
            generation,
        };
        let mut state = self.lock()?;
        // Cancellation, disk publication and in-memory activation share this commit boundary.
        ensure!(!state.cancelled, "resource installation cancelled");
        let records: Vec<_> = state
            .installed
            .iter()
            .filter(|(key, _)| key.as_str() != id)
            .map(|(_, installed)| &installed.record)
            .chain(std::iter::once(&record))
            .collect();
        atomic_write(
            &self.directory.join("active.json"),
            &serde_json::to_vec(&records)?,
        )?;
        lease.retired.store(false, Ordering::Release);
        if let Some(prepared) = prepared {
            prepared.activate();
        }
        if let Some(previous) = state
            .installed
            .insert(id.to_owned(), Installed { record, lease })
        {
            previous.lease.retired.store(true, Ordering::Release);
        }
        tracing::info!(resource = id, "activated resource generation");
        Ok(())
    }

    /// Remove the active installation, retiring its files after all query leases are released.
    ///
    /// # Errors
    /// Returns an error if state cannot be accessed, an installation is running,
    /// the resource is not installed, or its removal cannot be persisted atomically.
    pub fn uninstall(&self, id: &str) -> Result<DownloadStatus, ResourceError> {
        let mut state = self.lock()?;
        if state.task.is_some() {
            return Err(ResourceError::Conflict(
                "cancel and wait for the running installation before uninstalling",
            ));
        }
        if !state.installed.contains_key(id) {
            return Err(ResourceError::NotFound(id.to_owned()));
        }
        let records: Vec<_> = state
            .installed
            .iter()
            .filter(|(key, _)| key.as_str() != id)
            .map(|(_, installed)| &installed.record)
            .collect();
        atomic_write(
            &self.directory.join("active.json"),
            &serde_json::to_vec(&records).map_err(anyhow::Error::from)?,
        )?;
        if let Some(consumer) = self.consumers.get(id) {
            consumer.deactivate();
        }
        if let Some(previous) = state.installed.remove(id) {
            previous.lease.retired.store(true, Ordering::Release);
        }
        state.progress.remove(id);
        drop(state);
        tracing::info!(resource = id, "uninstalled resources");
        self.status()
    }
}

fn validate_identity(resource: &CatalogResource, manifest: &ResourceManifest) -> Result<()> {
    manifest.validate()?;
    ensure!(
        manifest.id == resource.id && manifest.version == resource.version,
        "catalog/resource identity mismatch"
    );
    Ok(())
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

#[cfg(test)]
mod tests;

//! Host-owned assembly and lifetime of local application capabilities.

use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU8, Ordering},
    },
};

use nib_app::{
    api::UserMessage,
    jobs::{JobError, JobQueue},
    media::MediaLibrary,
    persistence::{PersistenceError, SqliteDatabase},
};

use crate::{credentials::NativeCredentials, sdk::SdkClients, storage::StorageManager};

pub(crate) struct GenerationRuntime {
    pub(crate) queue: Arc<JobQueue>,
}

struct FeedbackSubscription {
    id: String,
    worker: Option<tauri::async_runtime::JoinHandle<()>>,
}

#[derive(Clone)]
pub(crate) struct DesktopState {
    pub(crate) storage: Arc<StorageManager>,
    data_access: Arc<tokio::sync::RwLock<()>>,
    migration_state: Arc<AtomicU8>,
    database: Arc<Mutex<Option<Arc<SqliteDatabase>>>>,
    media: Arc<Mutex<Option<Arc<MediaLibrary>>>>,
    sdk: Arc<Mutex<Option<Arc<SdkClients>>>>,
    generation: Arc<Mutex<Option<Arc<GenerationRuntime>>>>,
    feedback: Arc<Mutex<HashMap<String, FeedbackSubscription>>>,
    pub(crate) credentials: Arc<NativeCredentials>,
    pub(crate) lexicon: Arc<nib_lexicon::LexiconResources>,
    pub(crate) downloads: Arc<nib_resources::ResourceStore>,
}

impl DesktopState {
    pub(crate) fn new(base: &Path, development: bool) -> anyhow::Result<Self> {
        let storage = Arc::new(StorageManager::open(base, development)?);
        let lexicon = Arc::new(nib_lexicon::LexiconResources::default());
        let consumers: std::collections::BTreeMap<
            String,
            Arc<dyn nib_resources::ResourceConsumer>,
        > = std::collections::BTreeMap::from([(
            "lexicon".to_owned(),
            Arc::clone(&lexicon) as Arc<dyn nib_resources::ResourceConsumer>,
        )]);
        let downloads = Arc::new(nib_resources::ResourceStore::open(
            &base.join("resources"),
            consumers,
        )?);
        Ok(Self {
            storage: Arc::clone(&storage),
            data_access: Arc::new(tokio::sync::RwLock::new(())),
            migration_state: Arc::new(AtomicU8::new(0)),
            database: Arc::new(Mutex::new(None)),
            media: Arc::new(Mutex::new(None)),
            sdk: Arc::new(Mutex::new(None)),
            generation: Arc::new(Mutex::new(None)),
            feedback: Arc::new(Mutex::new(HashMap::new())),
            credentials: Arc::new(NativeCredentials::new(development, storage)),
            lexicon,
            downloads,
        })
    }

    /// Keeps lazy initialization and reads outside the relocation copy interval.
    pub(crate) async fn read_access(&self) -> tokio::sync::OwnedRwLockReadGuard<()> {
        Arc::clone(&self.data_access).read_owned().await
    }

    /// Holds a write operation open while relocation waits for all admitted writers.
    pub(crate) async fn write_access(
        &self,
    ) -> Result<tokio::sync::OwnedRwLockReadGuard<()>, PersistenceError> {
        let guard = Arc::clone(&self.data_access).read_owned().await;
        if self.migration_state.load(Ordering::Acquire) != 0 {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::MigrationInProgress,
            });
        }
        Ok(guard)
    }

    pub(crate) async fn credential_change_access(
        &self,
    ) -> Result<tokio::sync::OwnedRwLockWriteGuard<()>, PersistenceError> {
        let guard = Arc::clone(&self.data_access).write_owned().await;
        if self.migration_state.load(Ordering::Acquire) != 0 {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::RestartRequired,
            });
        }
        Ok(guard)
    }

    /// Stops new writes, drains paid requests and commits a verified copy before returning.
    pub(crate) async fn migrate_directory(
        &self,
        directory: Option<std::path::PathBuf>,
    ) -> Result<nib_app::settings::StorageLocations, JobError> {
        let desktop = self.clone();
        tauri::async_runtime::spawn(async move { desktop.perform_relocation(directory).await })
            .await
            .map_err(|error| {
                PersistenceError::failure("wait for the relocation coordinator", error)
            })?
    }

    async fn perform_relocation(
        &self,
        directory: Option<std::path::PathBuf>,
    ) -> Result<nib_app::settings::StorageLocations, JobError> {
        let database = self.database()?;
        if self
            .migration_state
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(JobError::Invalid(UserMessage::MigrationInProgress));
        }
        let queue = if let Ok(slot) = self.generation.lock() {
            slot.as_ref().map(|runtime| Arc::clone(&runtime.queue))
        } else {
            self.migration_state.store(0, Ordering::Release);
            return Err(PersistenceError::Locked.into());
        };
        let result = async {
            if let Some(queue) = &queue {
                queue.pause_and_drain().await?;
            }
            let guard = Arc::clone(&self.data_access).write_owned().await;
            let storage = Arc::clone(&self.storage);
            tauri::async_runtime::spawn_blocking(move || {
                let _guard = guard;
                database.prepare_relocation()?;
                storage.migrate_directory(directory.as_deref())
            })
            .await
            .map_err(|error| PersistenceError::failure("wait for data relocation", error))?
            .map_err(JobError::from)
        }
        .await;
        match result {
            Ok(locations) => {
                self.migration_state.store(
                    if locations.restart_required { 2 } else { 0 },
                    Ordering::Release,
                );
                if !locations.restart_required
                    && let Some(queue) = &queue
                {
                    queue.resume();
                }
                Ok(locations)
            },
            Err(error) => {
                self.migration_state.store(0, Ordering::Release);
                if let Some(queue) = &queue {
                    queue.resume();
                }
                Err(error)
            },
        }
    }

    pub(crate) fn database(&self) -> Result<Arc<SqliteDatabase>, PersistenceError> {
        let mut slot = self
            .database
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(database) = slot.as_ref() {
            return Ok(Arc::clone(database));
        }
        if self.migration_state.load(Ordering::Acquire) != 0 {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::MigrationDatabaseUnavailable,
            });
        }
        let data_dir = self.storage.data_directory()?;
        let database = Arc::new(SqliteDatabase::open(&data_dir.join("nib.sqlite3"))?);
        *slot = Some(Arc::clone(&database));
        tracing::info!("opened the local creation database");
        Ok(database)
    }

    pub(crate) fn media(&self) -> Result<Arc<MediaLibrary>, PersistenceError> {
        let mut slot = self
            .media
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(media) = slot.as_ref() {
            return Ok(Arc::clone(media));
        }
        if self.migration_state.load(Ordering::Acquire) != 0 {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::MigrationMediaUnavailable,
            });
        }
        let database = self.database()?;
        let media = Arc::new(MediaLibrary::new(
            database,
            self.storage.data_directory()?.join("media"),
        )?);
        *slot = Some(Arc::clone(&media));
        Ok(media)
    }

    pub(crate) fn invalidate_sdk(&self) -> Result<(), JobError> {
        if let Some(clients) = self
            .sdk
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?
            .as_ref()
        {
            clients.invalidate()?;
        }
        Ok(())
    }

    pub(crate) fn sdk(&self) -> Result<Arc<SdkClients>, JobError> {
        let mut slot = self
            .sdk
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(clients) = slot.as_ref() {
            return Ok(Arc::clone(clients));
        }
        let tokenizers = Arc::new(
            novelai_bridge::Tokenizers::bundled().map_err(novelai_bridge::BridgeError::from)?,
        );
        let clients = SdkClients::new(
            Arc::clone(&self.credentials),
            tokenizers,
            Arc::clone(&self.storage),
        );
        *slot = Some(Arc::clone(&clients));
        Ok(clients)
    }

    pub(crate) fn begin_feedback(&self, label: String, id: String) -> Result<(), PersistenceError> {
        let mut feedback = self
            .feedback
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(FeedbackSubscription {
            worker: Some(previous),
            ..
        }) = feedback.insert(label, FeedbackSubscription { id, worker: None })
        {
            previous.abort();
        }
        Ok(())
    }

    pub(crate) fn attach_feedback(
        &self,
        label: &str,
        id: &str,
        worker: tauri::async_runtime::JoinHandle<()>,
    ) -> Result<(), PersistenceError> {
        let Ok(mut feedback) = self.feedback.lock() else {
            worker.abort();
            return Err(PersistenceError::Locked);
        };
        if let Some(subscription) = feedback.get_mut(label)
            && subscription.id == id
        {
            if let Some(previous) = subscription.worker.replace(worker) {
                previous.abort();
            }
        } else {
            worker.abort();
        }
        Ok(())
    }

    pub(crate) fn stop_feedback(
        &self,
        label: &str,
        id: Option<&str>,
    ) -> Result<(), PersistenceError> {
        let mut feedback = self
            .feedback
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if feedback
            .get(label)
            .is_some_and(|subscription| id.is_none_or(|id| subscription.id == id))
            && let Some(FeedbackSubscription {
                worker: Some(worker),
                ..
            }) = feedback.remove(label)
        {
            worker.abort();
        }
        Ok(())
    }

    pub(crate) fn generation(&self) -> Result<Arc<GenerationRuntime>, JobError> {
        let mut slot = self
            .generation
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(runtime) = slot.as_ref() {
            return Ok(Arc::clone(runtime));
        }
        if self.migration_state.load(Ordering::Acquire) != 0 {
            return Err(JobError::Unavailable);
        }
        let database = self.database()?;
        let media = self.media()?;
        let clients = self.sdk()?;
        let queue = JobQueue::new(
            Arc::<SqliteDatabase>::clone(&database),
            database,
            Arc::<MediaLibrary>::clone(&media),
            Arc::<NativeCredentials>::clone(&self.credentials),
            Arc::<MediaLibrary>::clone(&media),
            Arc::<SdkClients>::clone(&clients),
            clients.tokenizers(),
        )?;
        let worker = Arc::clone(&queue);
        tauri::async_runtime::spawn(async move {
            if let Err(error) = worker.run().await {
                if let JobError::Persistence(error) = error {
                    tracing::error!(error = ?error, "generation queue storage failed; pending work was interrupted");
                } else {
                    tracing::error!("the generation worker stopped; pending work was interrupted");
                }
            }
        });
        let runtime = Arc::new(GenerationRuntime { queue });
        *slot = Some(Arc::clone(&runtime));
        Ok(runtime)
    }
}

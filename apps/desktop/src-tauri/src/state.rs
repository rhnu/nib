//! Host-owned assembly and lifetime of local application capabilities.

use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};

use nib_app::{
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
    database: Arc<Mutex<Option<Arc<SqliteDatabase>>>>,
    media: Arc<Mutex<Option<Arc<MediaLibrary>>>>,
    sdk: Arc<Mutex<Option<Arc<SdkClients>>>>,
    generation: Arc<Mutex<Option<Arc<GenerationRuntime>>>>,
    feedback: Arc<Mutex<HashMap<String, FeedbackSubscription>>>,
    pub(crate) credentials: Arc<NativeCredentials>,
}

impl DesktopState {
    pub(crate) fn new(base: &Path, development: bool) -> Result<Self, PersistenceError> {
        Ok(Self {
            storage: Arc::new(StorageManager::open(base, development)?),
            database: Arc::new(Mutex::new(None)),
            media: Arc::new(Mutex::new(None)),
            sdk: Arc::new(Mutex::new(None)),
            generation: Arc::new(Mutex::new(None)),
            feedback: Arc::new(Mutex::new(HashMap::new())),
            credentials: Arc::new(NativeCredentials::new(development)),
        })
    }

    pub(crate) fn database(&self) -> Result<Arc<SqliteDatabase>, PersistenceError> {
        let mut slot = self
            .database
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(database) = slot.as_ref() {
            return Ok(Arc::clone(database));
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
        let clients = Arc::new(SdkClients::new(
            Arc::clone(&self.credentials),
            tokenizers,
            Arc::clone(&self.storage),
        ));
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

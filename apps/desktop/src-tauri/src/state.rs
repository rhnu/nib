//! Host-owned assembly and lifetime of local application capabilities.

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use nib_app::{
    jobs::{JobError, JobQueue},
    media::MediaLibrary,
    persistence::{PersistenceError, SqliteDatabase},
};

use crate::credentials::NativeCredentials;

pub(crate) struct GenerationRuntime {
    pub(crate) queue: Arc<JobQueue>,
    pub(crate) media: Arc<MediaLibrary>,
}

#[derive(Clone)]
pub(crate) struct DesktopState {
    data_dir: PathBuf,
    database: Arc<Mutex<Option<Arc<SqliteDatabase>>>>,
    generation: Arc<Mutex<Option<Arc<GenerationRuntime>>>>,
    pub(crate) credentials: Arc<NativeCredentials>,
}

impl DesktopState {
    pub(crate) fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            database: Arc::new(Mutex::new(None)),
            generation: Arc::new(Mutex::new(None)),
            credentials: Arc::new(NativeCredentials::default()),
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
        std::fs::create_dir_all(&self.data_dir).map_err(|error| {
            PersistenceError::failure("create the application data directory", error)
        })?;
        let database = Arc::new(SqliteDatabase::open(&self.data_dir.join("nib.sqlite3"))?);
        *slot = Some(Arc::clone(&database));
        tracing::info!("opened the local creation database");
        Ok(database)
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
        let media = Arc::new(MediaLibrary::new(
            Arc::clone(&database),
            self.data_dir.join("media"),
        )?);
        let queue = JobQueue::new(
            Arc::<SqliteDatabase>::clone(&database),
            database,
            Arc::<MediaLibrary>::clone(&media),
            Arc::<NativeCredentials>::clone(&self.credentials),
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
        let runtime = Arc::new(GenerationRuntime { queue, media });
        *slot = Some(Arc::clone(&runtime));
        Ok(runtime)
    }
}

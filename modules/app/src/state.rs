//! Application capability state, retained-data access and background job coordination.

use std::sync::{Arc, Mutex};

mod access;
mod relocation;

use access::DataAccess;
use tracing::Instrument as _;

use crate::{
    api::UserMessage,
    bootstrap::Bootstrap,
    downloads::Downloads,
    jobs::{JobError, JobQueue},
    lexicon::LexiconSearch,
    media::MediaLibrary,
    persistence::{PersistenceError, SqliteDatabase},
    sdk::{SdkClients, TransportFactory},
    settings::{
        ApplicationPreferences, ApplicationSettingsSnapshot, CredentialStore, GlobalSettingsStore,
        StorageBackend,
    },
};

/// Shared application capabilities; frontend subscriptions belong to the host.
#[derive(Clone)]
pub struct AppState {
    inner: Arc<State>,
}

struct State {
    settings: Arc<GlobalSettingsStore>,
    storage: Arc<dyn StorageBackend>,
    credentials: Arc<dyn CredentialStore>,
    transports: Arc<dyn TransportFactory>,
    runtime: tokio::runtime::Handle,
    access: DataAccess,
    database: Mutex<Option<Arc<SqliteDatabase>>>,
    media: Mutex<Option<Arc<MediaLibrary>>>,
    sdk: Mutex<Option<Arc<SdkClients>>>,
    generation: Mutex<Option<Arc<JobQueue>>>,
    lexicon: Arc<dyn LexiconSearch>,
    downloads: Downloads,
}

impl AppState {
    pub(crate) fn new(
        bootstrap: Bootstrap,
        lexicon: Arc<dyn LexiconSearch>,
        downloads: Downloads,
    ) -> Self {
        Self {
            inner: Arc::new(State {
                settings: bootstrap.settings,
                storage: bootstrap.storage,
                credentials: bootstrap.credentials,
                transports: bootstrap.transports,
                runtime: bootstrap.runtime,
                access: DataAccess::default(),
                database: Mutex::new(None),
                media: Mutex::new(None),
                sdk: Mutex::new(None),
                generation: Mutex::new(None),
                lexicon,
                downloads,
            }),
        }
    }

    /// Global settings are independent of the creation-data directory.
    pub fn settings(&self) -> &GlobalSettingsStore { &self.inner.settings }

    /// The host supplies the native credential implementation through its domain contract.
    pub fn credentials(&self) -> &dyn CredentialStore { self.inner.credentials.as_ref() }

    /// Reads preferences and storage locations without starting generation.
    /// # Errors
    /// Returns configuration or directory-display failures.
    pub fn settings_snapshot(&self) -> Result<ApplicationSettingsSnapshot, PersistenceError> {
        Ok(ApplicationSettingsSnapshot {
            preferences: self.inner.settings.preferences()?,
            storage: self.inner.storage.locations()?,
        })
    }

    /// Persists preferences and invalidates clients when their execution settings change.
    /// # Errors
    /// Returns rejected preferences, storage or SDK state failures.
    pub fn save_preferences(
        &self,
        preferences: &ApplicationPreferences,
    ) -> Result<ApplicationPreferences, JobError> {
        if !(1..=200).contains(&preferences.recent_image_limit) {
            return Err(JobError::Invalid(UserMessage::RecentImageLimit));
        }
        let previous = self.inner.settings.preferences()?;
        let saved = self.inner.settings.save_preferences(preferences)?;
        if previous.execution != saved.execution {
            self.invalidate_sdk()?;
            tracing::debug!(
                custom_api_endpoint = saved.execution.image_base_url.is_some(),
                "SDK execution preferences changed; clients and account snapshots invalidated"
            );
        }
        Ok(saved)
    }

    /// Queries share a vocabulary snapshot independent of creation-data migration.
    pub fn lexicon(&self) -> &dyn LexiconSearch { self.inner.lexicon.as_ref() }

    /// Installation tasks are held for the lifetime of the application.
    pub fn downloads(&self) -> &Downloads { &self.inner.downloads }

    /// Reads wait for relocation I/O while existing data remains available after publication.
    pub async fn read_access(&self) -> tokio::sync::OwnedRwLockReadGuard<()> {
        self.inner.access.read().await
    }

    /// Admits a retained-data writer until relocation starts or a restart is required.
    /// # Errors
    /// Returns the current relocation or restart requirement.
    pub async fn write_access(
        &self,
    ) -> Result<tokio::sync::OwnedRwLockReadGuard<()>, PersistenceError> {
        self.inner.access.write().await
    }

    /// Serializes credential changes against submissions and data relocation.
    /// # Errors
    /// Returns the current relocation or restart requirement.
    pub async fn credential_change_access(
        &self,
    ) -> Result<tokio::sync::OwnedRwLockWriteGuard<()>, PersistenceError> {
        self.inner.access.exclusive_write().await
    }

    /// Opens and shares the creation database when first required.
    /// # Errors
    /// Returns access, directory, schema or database failures.
    pub fn database(&self) -> Result<Arc<SqliteDatabase>, PersistenceError> {
        let mut slot = self
            .inner
            .database
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(database) = slot.as_ref() {
            return Ok(Arc::clone(database));
        }
        if !self.inner.access.is_writable() {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::MigrationDatabaseUnavailable,
            });
        }
        let data_dir = self.inner.storage.data_directory()?;
        let database = Arc::new(SqliteDatabase::open(&data_dir.join("nib.sqlite3"))?);
        *slot = Some(Arc::clone(&database));
        tracing::info!("opened the local creation database");
        Ok(database)
    }

    /// Opens retained media with the same database and data directory.
    /// # Errors
    /// Returns access, directory or media-store initialization failures.
    pub fn media(&self) -> Result<Arc<MediaLibrary>, PersistenceError> {
        let mut slot = self
            .inner
            .media
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(media) = slot.as_ref() {
            return Ok(Arc::clone(media));
        }
        if !self.inner.access.is_writable() {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::MigrationMediaUnavailable,
            });
        }
        let database = self.database()?;
        let media = Arc::new(MediaLibrary::new(
            database,
            self.inner.storage.data_directory()?.join("media"),
        )?);
        *slot = Some(Arc::clone(&media));
        Ok(media)
    }

    /// Invalidates initialized clients after an account or execution setting change.
    /// # Errors
    /// Returns credential, configuration or SDK shared-state failures.
    pub fn invalidate_sdk(&self) -> Result<(), JobError> {
        if let Some(clients) = self
            .inner
            .sdk
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?
            .as_ref()
        {
            clients.invalidate()?;
        }
        Ok(())
    }

    /// Initializes shared tokenizers, clients and account sampling independently of generation.
    /// # Errors
    /// Returns tokenizer or shared-state failures.
    pub fn sdk(&self) -> Result<Arc<SdkClients>, JobError> {
        let mut slot = self
            .inner
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
            Arc::clone(&self.inner.credentials),
            tokenizers,
            Arc::clone(&self.inner.settings),
            Arc::clone(&self.inner.transports),
            &self.inner.runtime,
        );
        *slot = Some(Arc::clone(&clients));
        Ok(clients)
    }

    /// Restores retained jobs and starts the application's sole sequential worker on demand.
    /// # Errors
    /// Returns initialization, recovery or unavailable application-state failures.
    pub fn generation(&self) -> Result<Arc<JobQueue>, JobError> {
        let mut slot = self
            .inner
            .generation
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(runtime) = slot.as_ref() {
            return Ok(Arc::clone(runtime));
        }
        if !self.inner.access.is_writable() {
            return Err(JobError::Unavailable);
        }
        let database = self.database()?;
        let media = self.media()?;
        let clients = self.sdk()?;
        let queue = JobQueue::new(
            Arc::<SqliteDatabase>::clone(&database),
            database,
            Arc::<MediaLibrary>::clone(&media),
            Arc::clone(&self.inner.credentials),
            Arc::<MediaLibrary>::clone(&media),
            Arc::<SdkClients>::clone(&clients),
            clients.tokenizers(),
        )?;
        let worker = Arc::clone(&queue);
        self.inner.runtime.spawn(async move {
            if let Err(error) = worker.run().await {
                if let JobError::Persistence(error) = error {
                    tracing::error!(detail = %crate::api::error_detail(&error), "generation queue storage failed; pending work was interrupted");
                } else {
                    tracing::error!("the generation worker stopped; pending work was interrupted");
                }
            }
        }.in_current_span());
        *slot = Some(Arc::clone(&queue));
        Ok(queue)
    }
}

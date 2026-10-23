//! Host-owned SDK clients share tokenizers and account state until credentials change.

use std::sync::{Arc, Mutex};

use nib_app::{
    jobs::{JobError, SdkClientProvider},
    persistence::PersistenceError,
    settings::{CredentialStore as _, ExecutionPreferences},
};
use novelai_bridge::{
    ApiKeySource, Client, CreditEvent, CreditObserver, ReqwestOptions, ReqwestTransport,
    SecretString, Tokenizers, Transport,
};
use secrecy::ExposeSecret as _;

use crate::{credentials::NativeCredentials, storage::StorageManager};

struct CachedClient {
    key: SecretString,
    client: Client<dyn Transport>,
    execution: ExecutionPreferences,
}

pub(crate) struct SdkClients {
    credentials: Arc<NativeCredentials>,
    tokenizers: Arc<Tokenizers>,
    storage: Arc<StorageManager>,
    cached: Mutex<Vec<CachedClient>>,
}

impl SdkClients {
    pub(crate) fn new(
        credentials: Arc<NativeCredentials>,
        tokenizers: Arc<Tokenizers>,
        storage: Arc<StorageManager>,
    ) -> Self {
        Self {
            credentials,
            tokenizers,
            storage,
            cached: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn invalidate(&self) -> Result<(), JobError> {
        self.cached
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?
            .clear();
        Ok(())
    }

    pub(crate) fn tokenizers(&self) -> Arc<Tokenizers> { Arc::clone(&self.tokenizers) }
}

impl SdkClientProvider for SdkClients {
    fn client(&self) -> Result<Client<dyn Transport>, JobError> {
        self.client_for(self.execution_preferences()?)
    }

    fn execution_preferences(&self) -> Result<ExecutionPreferences, JobError> {
        Ok(self.storage.settings.preferences()?.execution)
    }

    fn client_for(
        &self,
        execution: ExecutionPreferences,
    ) -> Result<Client<dyn Transport>, JobError> {
        let mut cached = self
            .cached
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        // Credential writes release their own lock before invalidation takes this one.
        // Reading under this lock prevents an old key from repopulating an invalidated cache.
        let key = self
            .credentials
            .load()?
            .ok_or(JobError::MissingCredentials)?;
        cached.retain(|existing| existing.key.expose_secret() == key.expose_secret());
        if let Some(existing) = cached
            .iter()
            .find(|existing| existing.execution == execution)
        {
            return Ok(existing.client.clone());
        }
        let transport = ReqwestTransport::new(ReqwestOptions {
            api_key_source: ApiKeySource::Inline { value: key.clone() },
            ..ReqwestOptions::default()
        })
        .map_err(novelai_bridge::BridgeError::from)?;
        let transport: Arc<dyn Transport> = Arc::new(transport);
        let client = Client::new(transport, execution.client_config())
            .with_tokenizers(Arc::clone(&self.tokenizers))
            .with_credit_observer(Arc::new(CreditDiagnostics));
        // The two binary execution switches permit at most four clients. Frozen queued
        // jobs keep their own cache without displacing the current preference's account.
        cached.push(CachedClient {
            key,
            client: client.clone(),
            execution,
        });
        Ok(client)
    }

    fn cached_client(&self) -> Option<Client<dyn Transport>> {
        let cached = self.cached.lock().ok()?;
        let execution = self.storage.settings.preferences().ok()?.execution;
        cached
            .iter()
            .find(|value| value.execution == execution)
            .map(|value| value.client.clone())
    }
}

struct CreditDiagnostics;

#[async_trait::async_trait]
impl CreditObserver for CreditDiagnostics {
    async fn observe(&self, event: CreditEvent) {
        match event {
            CreditEvent::RequestPlanned {
                fingerprint,
                estimate,
            } => {
                tracing::debug!(
                    request_id = fingerprint.request_id,
                    estimated_anlas = estimate.total(),
                    "NovelAI request estimate"
                );
            },
            CreditEvent::RequestSettled {
                fingerprint,
                outcome,
            } => {
                tracing::debug!(request_id = fingerprint.request_id,
                    outcome = ?outcome, "NovelAI request settled");
            },
            CreditEvent::BalanceSampled { .. } => {
                tracing::debug!("NovelAI account snapshot refreshed");
            },
        }
    }
}

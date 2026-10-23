//! Host-owned SDK clients share tokenizers and account state until credentials change.

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};

use nib_app::{
    jobs::{JobError, SdkClientProvider},
    persistence::PersistenceError,
    settings::{AccountSample, CredentialStore as _, ExecutionPreferences},
};
use novelai_bridge::{
    ApiKeySource, Client, CreditEvent, CreditObserver, ReqwestOptions, ReqwestTransport,
    SecretString, Tokenizers, Transport,
};
use secrecy::ExposeSecret as _;

use crate::{credentials::NativeCredentials, storage::StorageManager};

struct CachedClient {
    id: u64,
    sample: Option<AccountSample>,
    key: SecretString,
    client: Client<dyn Transport>,
    execution: ExecutionPreferences,
}

struct SelectedClient {
    client: Client<dyn Transport>,
    id: u64,
    account: Option<AccountSample>,
}

pub(crate) struct SdkClients {
    credentials: Arc<NativeCredentials>,
    tokenizers: Arc<Tokenizers>,
    storage: Arc<StorageManager>,
    cached: Mutex<Vec<CachedClient>>,
    next_id: AtomicU64,
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
            next_id: AtomicU64::new(1),
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

    /// Account reads and explicit sampling do not construct the generation queue.
    pub(crate) fn account(&self) -> Option<nib_app::settings::AccountSummary> {
        self.account_sample().map(|sample| sample.summary())
    }

    pub(crate) fn begin_account_refresh(&self) -> Result<(Client<dyn Transport>, u64), JobError> {
        self.select_client(self.execution_preferences()?)
            .map(|selected| (selected.client, selected.id))
    }

    pub(crate) fn finish_account_refresh(
        &self,
        id: u64,
        info: &novelai_bridge::SubscriptionInfo,
    ) -> Result<nib_app::settings::AccountSummary, JobError> {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| PersistenceError::failure("sample the account clock", error))?
            .as_millis();
        let sampled_at = i64::try_from(millis).map_err(|error| {
            PersistenceError::failure("represent the account sampling time", error)
        })?;
        let mut cached = self
            .cached
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        let current = cached
            .iter_mut()
            .find(|value| value.id == id)
            .ok_or_else(|| JobError::Invalid("账户配置已改变，请重新刷新。".to_owned()))?;
        let sample = AccountSample {
            subscription: info.clone(),
            sampled_at,
        };
        let summary = sample.summary();
        current.sample = Some(sample);
        Ok(summary)
    }

    fn select_client(&self, execution: ExecutionPreferences) -> Result<SelectedClient, JobError> {
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
            return Ok(SelectedClient {
                client: existing.client.clone(),
                id: existing.id,
                account: existing.sample.clone(),
            });
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
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        cached.push(CachedClient {
            id,
            sample: None,
            key,
            client: client.clone(),
            execution,
        });
        Ok(SelectedClient {
            client,
            id,
            account: None,
        })
    }
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
        self.select_client(execution)
            .map(|selected| selected.client)
    }

    fn account_sample(&self) -> Option<AccountSample> {
        let execution = self.storage.settings.preferences().ok()?.execution;
        self.cached
            .lock()
            .ok()?
            .iter()
            .find(|cached| cached.execution == execution)?
            .sample
            .clone()
    }

    fn execution_context(
        &self,
        execution: ExecutionPreferences,
    ) -> Result<(Client<dyn Transport>, Option<AccountSample>), JobError> {
        self.select_client(execution)
            .map(|selected| (selected.client, selected.account))
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

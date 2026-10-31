//! Immutable credential clients and one automatic account sampler shared by the application.

use std::{
    sync::{Arc, Mutex, Weak},
    time::{SystemTime, UNIX_EPOCH},
};

use novelai_bridge::{
    BridgeError, Client, CreditEvent, CreditObserver, SecretString, SubscriptionInfo, Tokenizers,
    Transport,
};
use tokio::runtime::Handle;
use tracing::Instrument as _;

use crate::{
    jobs::{JobError, SdkClientProvider},
    persistence::PersistenceError,
    settings::{
        AccountSample, AccountSnapshot, CredentialStore, ExecutionPreferences, GlobalSettingsStore,
    },
};

/// Creates a platform transport without taking ownership of application client state.
pub trait TransportFactory: Send + Sync {
    /// Builds an authenticated transport for exactly the supplied immutable key.
    ///
    /// # Errors
    /// Returns the SDK construction error with its original cause.
    fn create(&self, key: SecretString) -> Result<Arc<dyn Transport>, BridgeError>;
}

struct CachedClient {
    credential_id: String,
    execution: ExecutionPreferences,
    client: Client<dyn Transport>,
}

struct AccountRefresh {
    identity: (String, String),
    epoch: u64,
    client: Client<dyn Transport>,
}

#[derive(Default)]
struct SamplingState {
    identity: Option<(String, String)>,
    sample: Option<AccountSample>,
    snapshot: AccountSnapshot,
    epoch: u64,
    refresh_pending: bool,
}

impl SamplingState {
    fn synchronize_identity(&mut self, identity: Option<(String, String)>) {
        if self.identity != identity {
            *self = Self {
                identity,
                epoch: self.epoch.wrapping_add(1),
                snapshot: AccountSnapshot {
                    revision: self.snapshot.revision.wrapping_add(1),
                    ..AccountSnapshot::default()
                },
                ..Self::default()
            };
        }
    }

    fn begin_refresh(&mut self, force: bool, now: i64) -> Option<u64> {
        if self.snapshot.refreshing {
            if force {
                self.refresh_pending = true;
            }
            return None;
        }
        let fresh = self
            .sample
            .as_ref()
            .is_some_and(|sample| now.saturating_sub(sample.sampled_at) < 60_000);
        if !force && fresh {
            return None;
        }
        self.snapshot.stale = self
            .sample
            .as_ref()
            .is_some_and(|sample| now.saturating_sub(sample.sampled_at) >= 60_000);
        self.snapshot.refreshing = true;
        self.snapshot.revision = self.snapshot.revision.wrapping_add(1);
        Some(self.epoch)
    }

    /// Identity alone is insufficient when an account is replaced and then selected again.
    fn complete_refresh(
        &mut self,
        current: Option<&(String, String)>,
        identity: &(String, String),
        epoch: u64,
        response: Result<SubscriptionInfo, BridgeError>,
        now: i64,
    ) -> Option<bool> {
        if current != Some(identity)
            || self.identity.as_ref() != Some(identity)
            || self.epoch != epoch
        {
            return None;
        }
        self.snapshot.refreshing = false;
        self.snapshot.revision = self.snapshot.revision.wrapping_add(1);
        match response {
            Ok(subscription) => {
                let sample = AccountSample {
                    subscription,
                    sampled_at: now,
                };
                self.snapshot.summary = Some(sample.summary());
                self.snapshot.stale = false;
                self.snapshot.error = None;
                self.sample = Some(sample);
                tracing::debug!("account sampling completed");
            },
            Err(error) => {
                self.snapshot.stale = true;
                self.snapshot.error = Some(JobError::Bridge(error).user_message());
                tracing::warn!("automatic account sampling failed");
            },
        }
        Some(std::mem::take(&mut self.refresh_pending))
    }
}

/// Shared SDK clients and account samples bound to immutable credentials and execution options.
pub struct SdkClients {
    credentials: Arc<dyn CredentialStore>,
    tokenizers: Arc<Tokenizers>,
    settings: Arc<GlobalSettingsStore>,
    transports: Arc<dyn TransportFactory>,
    runtime: Handle,
    cached: Mutex<Vec<CachedClient>>,
    sampling: Mutex<SamplingState>,
    weak: Weak<Self>,
}

impl SdkClients {
    /// Starts the account sampler on the runtime supplied by the host.
    pub fn new(
        credentials: Arc<dyn CredentialStore>,
        tokenizers: Arc<Tokenizers>,
        settings: Arc<GlobalSettingsStore>,
        transports: Arc<dyn TransportFactory>,
        runtime: &Handle,
    ) -> Arc<Self> {
        let sdk = Arc::new_cyclic(|weak| Self {
            credentials,
            tokenizers,
            settings,
            transports,
            runtime: runtime.clone(),
            cached: Mutex::new(Vec::new()),
            sampling: Mutex::new(SamplingState::default()),
            weak: Weak::clone(weak),
        });
        let weak = Arc::downgrade(&sdk);
        runtime.spawn(
            async move {
                loop {
                    let Some(sdk) = weak.upgrade() else {
                        break;
                    };
                    sdk.refresh_account(false).await;
                    drop(sdk);
                    tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                }
            }
            .in_current_span(),
        );
        sdk
    }

    /// Discards cached clients and refreshes the active account after settings change.
    ///
    /// # Errors
    /// Returns credential, settings or shared-state access failures.
    pub fn invalidate(&self) -> Result<(), JobError> {
        self.cached
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?
            .clear();
        let identity = self.active_identity()?;
        let mut state = self
            .sampling
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        state.synchronize_identity(identity);
        drop(state);
        self.request_refresh();
        Ok(())
    }

    /// Shares the same local tokenizers used by SDK request preparation.
    pub fn tokenizers(&self) -> Arc<Tokenizers> { Arc::clone(&self.tokenizers) }

    fn active_identity(&self) -> Result<Option<(String, String)>, JobError> {
        let Some(id) = self.settings.active_credential()? else {
            return Ok(None);
        };
        Ok(Some((
            id,
            self.settings
                .preferences()?
                .execution
                .client_config()
                .image_base_url,
        )))
    }

    /// Reads the active account's sampling state without contacting the provider.
    ///
    /// # Errors
    /// Returns credential, settings or shared-state access failures.
    pub fn account(&self) -> Result<AccountSnapshot, JobError> {
        let identity = self.active_identity()?;
        let mut state = self
            .sampling
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        state.synchronize_identity(identity);
        Ok(state.snapshot.clone())
    }

    fn request_refresh(&self) {
        if let Some(sdk) = self.weak.upgrade() {
            self.runtime
                .spawn(async move { sdk.refresh_account(true).await }.in_current_span());
        }
    }

    fn begin_account_refresh(&self, force: bool) -> Result<Option<AccountRefresh>, JobError> {
        let Some(credential_id) = self.settings.active_credential()? else {
            return Ok(None);
        };
        let execution = self.execution_preferences()?;
        // The sampled identity must describe the endpoint used by this exact client.
        let identity = (credential_id, execution.client_config().image_base_url);
        let mut state = self
            .sampling
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        state.synchronize_identity(Some(identity.clone()));
        let Some(epoch) = state.begin_refresh(force, now_millis()) else {
            return Ok(None);
        };
        drop(state);
        let client = self.client_for(execution, &identity.0)?;
        Ok(Some(AccountRefresh {
            identity,
            epoch,
            client,
        }))
    }

    /// Coalesces concurrent triggers and rejects results from replaced identities.
    pub async fn refresh_account(&self, force: bool) {
        let prepared = self.begin_account_refresh(force);
        let AccountRefresh {
            identity,
            epoch,
            client,
        } = match prepared {
            Ok(Some(value)) => value,
            Ok(None) => return,
            Err(error) => {
                if let Ok(mut state) = self.sampling.lock() {
                    state.snapshot.refreshing = false;
                    state.snapshot.stale = true;
                    state.snapshot.error = Some(error.user_message());
                    state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
                }
                tracing::warn!("cannot prepare automatic account sampling");
                return;
            },
        };
        let response = client.get_subscription().await;
        let current = match self.active_identity() {
            Ok(current) => current,
            Err(error) => {
                if let Ok(mut state) = self.sampling.lock()
                    && state.epoch == epoch
                {
                    state.snapshot.refreshing = false;
                    state.snapshot.stale = true;
                    state.snapshot.error = Some(error.user_message());
                    state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
                }
                tracing::warn!("cannot resolve sampled account identity");
                return;
            },
        };
        let Ok(mut state) = self.sampling.lock() else {
            return;
        };
        let Some(refresh_pending) =
            state.complete_refresh(current.as_ref(), &identity, epoch, response, now_millis())
        else {
            return;
        };
        drop(state);
        if refresh_pending {
            self.request_refresh();
        }
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|value| i64::try_from(value.as_millis()).ok())
        .unwrap_or(0)
}

impl SdkClientProvider for SdkClients {
    fn credential_id(&self) -> Result<String, JobError> {
        self.settings
            .active_credential()?
            .ok_or(JobError::MissingCredentials)
    }

    fn client(&self) -> Result<Client<dyn Transport>, JobError> {
        self.client_for(self.execution_preferences()?, &self.credential_id()?)
    }

    fn execution_preferences(&self) -> Result<ExecutionPreferences, JobError> {
        Ok(self.settings.preferences()?.execution)
    }

    fn client_for(
        &self,
        execution: ExecutionPreferences,
        credential_id: &str,
    ) -> Result<Client<dyn Transport>, JobError> {
        let mut cached = self
            .cached
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(existing) = cached.iter().find(|existing| {
            existing.credential_id == credential_id && existing.execution == execution
        }) {
            return Ok(existing.client.clone());
        }
        let key = self
            .credentials
            .load(credential_id)?
            .ok_or(JobError::MissingCredentials)?;
        let transport = self.transports.create(key)?;
        let client = Client::new(transport, execution.client_config())
            .with_tokenizers(Arc::clone(&self.tokenizers))
            .with_credit_observer(Arc::new(CreditDiagnostics));
        cached.push(CachedClient {
            credential_id: credential_id.into(),
            execution,
            client: client.clone(),
        });
        Ok(client)
    }

    fn account_sample(&self) -> Option<AccountSample> {
        let identity = self.active_identity().ok()?;
        let state = self.sampling.lock().ok()?;
        (state.identity == identity)
            .then(|| state.sample.clone())
            .flatten()
    }

    fn execution_context(
        &self,
        execution: ExecutionPreferences,
        credential_id: &str,
    ) -> Result<(Client<dyn Transport>, Option<AccountSample>), JobError> {
        let client = self.client_for(execution.clone(), credential_id)?;
        let state = self
            .sampling
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        let sample = (state.identity.as_ref()
            == Some(&(
                credential_id.to_owned(),
                execution.client_config().image_base_url,
            )))
        .then(|| state.sample.clone())
        .flatten();
        Ok((client, sample))
    }

    fn request_settled(&self, credential_id: &str, execution: &ExecutionPreferences) {
        if self.active_identity().ok().flatten().as_ref()
            == Some(&(
                credential_id.into(),
                execution.client_config().image_base_url,
            ))
        {
            self.request_refresh();
        }
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

#[cfg(test)]
mod tests;

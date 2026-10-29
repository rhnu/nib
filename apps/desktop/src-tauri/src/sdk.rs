//! Immutable credential clients and one automatic account sampler shared by the host.

use std::{
    sync::{Arc, Mutex, Weak},
    time::{SystemTime, UNIX_EPOCH},
};

use nib_app::{
    jobs::{JobError, SdkClientProvider},
    persistence::PersistenceError,
    settings::{AccountSample, AccountSnapshot, CredentialStore as _, ExecutionPreferences},
};
use novelai_bridge::{
    ApiKeySource, Client, CreditEvent, CreditObserver, ReqwestOptions, ReqwestTransport,
    Tokenizers, Transport,
};

use crate::{credentials::NativeCredentials, storage::StorageManager};

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

pub(crate) struct SdkClients {
    credentials: Arc<NativeCredentials>,
    tokenizers: Arc<Tokenizers>,
    storage: Arc<StorageManager>,
    cached: Mutex<Vec<CachedClient>>,
    sampling: Mutex<SamplingState>,
    weak: Weak<Self>,
}

impl SdkClients {
    pub(crate) fn new(
        credentials: Arc<NativeCredentials>,
        tokenizers: Arc<Tokenizers>,
        storage: Arc<StorageManager>,
    ) -> Arc<Self> {
        let sdk = Arc::new_cyclic(|weak| Self {
            credentials,
            tokenizers,
            storage,
            cached: Mutex::new(Vec::new()),
            sampling: Mutex::new(SamplingState::default()),
            weak: Weak::clone(weak),
        });
        let weak = Arc::downgrade(&sdk);
        tauri::async_runtime::spawn(async move {
            loop {
                let Some(sdk) = weak.upgrade() else {
                    break;
                };
                sdk.refresh_account(false).await;
                drop(sdk);
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            }
        });
        sdk
    }

    pub(crate) fn invalidate(&self) -> Result<(), JobError> {
        self.cached
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?
            .clear();
        let identity = self.active_identity()?;
        let mut state = self
            .sampling
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if state.identity != identity {
            let revision = state.snapshot.revision.wrapping_add(1);
            let epoch = state.epoch.wrapping_add(1);
            *state = SamplingState {
                identity,
                epoch,
                refresh_pending: false,
                snapshot: AccountSnapshot {
                    revision,
                    ..AccountSnapshot::default()
                },
                sample: None,
            };
        }
        drop(state);
        self.request_refresh();
        Ok(())
    }

    pub(crate) fn tokenizers(&self) -> Arc<Tokenizers> { Arc::clone(&self.tokenizers) }

    fn active_identity(&self) -> Result<Option<(String, String)>, JobError> {
        let Some(id) = self.credentials.active_id()? else {
            return Ok(None);
        };
        Ok(Some((
            id,
            self.storage
                .settings
                .preferences()?
                .execution
                .client_config()
                .image_base_url,
        )))
    }

    pub(crate) fn account(&self) -> Result<AccountSnapshot, JobError> {
        let identity = self.active_identity()?;
        let mut state = self
            .sampling
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if state.identity != identity {
            let revision = state.snapshot.revision.wrapping_add(1);
            let epoch = state.epoch.wrapping_add(1);
            *state = SamplingState {
                identity,
                epoch,
                refresh_pending: false,
                snapshot: AccountSnapshot {
                    revision,
                    ..AccountSnapshot::default()
                },
                sample: None,
            };
        }
        Ok(state.snapshot.clone())
    }

    fn request_refresh(&self) {
        if let Some(sdk) = self.weak.upgrade() {
            tauri::async_runtime::spawn(async move {
                sdk.refresh_account(true).await;
            });
        }
    }

    fn begin_account_refresh(&self, force: bool) -> Result<Option<AccountRefresh>, JobError> {
        let Some(identity) = self.active_identity()? else {
            return Ok(None);
        };
        let execution = self.execution_preferences()?;
        let mut state = self
            .sampling
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if state.identity.as_ref() != Some(&identity) {
            let revision = state.snapshot.revision.wrapping_add(1);
            let epoch = state.epoch.wrapping_add(1);
            *state = SamplingState {
                identity: Some(identity.clone()),
                epoch,
                refresh_pending: false,
                snapshot: AccountSnapshot {
                    revision,
                    ..AccountSnapshot::default()
                },
                sample: None,
            };
        }
        if state.snapshot.refreshing {
            if force {
                state.refresh_pending = true;
            }
            return Ok(None);
        }
        let fresh = state
            .sample
            .as_ref()
            .is_some_and(|sample| now_millis().saturating_sub(sample.sampled_at) < 60_000);
        if !force && fresh {
            return Ok(None);
        }
        state.snapshot.stale = state
            .sample
            .as_ref()
            .is_some_and(|sample| now_millis().saturating_sub(sample.sampled_at) >= 60_000);
        state.snapshot.refreshing = true;
        state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
        let epoch = state.epoch;
        drop(state);
        let client = self.client_for(execution, &identity.0)?;
        Ok(Some(AccountRefresh {
            identity,
            epoch,
            client,
        }))
    }

    /// Coalesces concurrent triggers and rejects results from replaced identities.
    pub(crate) async fn refresh_account(&self, force: bool) {
        let prepared = self.begin_account_refresh(force);
        let AccountRefresh {
            identity,
            epoch,
            client,
        } = match prepared {
            Ok(Some(value)) => value,
            Ok(None) => return,
            Err(_error) => {
                if let Ok(mut state) = self.sampling.lock() {
                    state.snapshot.refreshing = false;
                    state.snapshot.stale = true;
                    state.snapshot.error =
                        Some("无法读取账户凭据或创建连接，请检查配置后重试。".into());
                    state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
                }
                tracing::warn!("cannot prepare automatic account sampling");
                return;
            },
        };
        let response = client.get_subscription().await;
        let current = match self.active_identity() {
            Ok(current) => current,
            Err(_error) => {
                if let Ok(mut state) = self.sampling.lock()
                    && state.epoch == epoch
                {
                    state.snapshot.refreshing = false;
                    state.snapshot.stale = true;
                    state.snapshot.error = Some("无法读取当前账户配置，请重试。".into());
                    state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
                }
                tracing::warn!("cannot resolve sampled account identity");
                return;
            },
        };
        let Ok(mut state) = self.sampling.lock() else {
            return;
        };
        if current.as_ref() != Some(&identity)
            || state.identity.as_ref() != Some(&identity)
            || state.epoch != epoch
        {
            return;
        }
        state.snapshot.refreshing = false;
        state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
        match response {
            Ok(subscription) => {
                let sample = AccountSample {
                    subscription,
                    sampled_at: now_millis(),
                };
                state.snapshot.summary = Some(sample.summary());
                state.snapshot.stale = false;
                state.snapshot.error = None;
                state.sample = Some(sample);
                tracing::debug!("account sampling completed");
            },
            Err(_error) => {
                state.snapshot.stale = true;
                state.snapshot.error = Some("账户查询失败，请检查网络与凭据后重试。".into());
                tracing::warn!("automatic account sampling failed");
            },
        }
        let refresh_pending = std::mem::take(&mut state.refresh_pending);
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
        self.credentials
            .active_id()?
            .ok_or(JobError::MissingCredentials)
    }

    fn client(&self) -> Result<Client<dyn Transport>, JobError> {
        self.client_for(self.execution_preferences()?, &self.credential_id()?)
    }

    fn execution_preferences(&self) -> Result<ExecutionPreferences, JobError> {
        Ok(self.storage.settings.preferences()?.execution)
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
        let transport: Arc<dyn Transport> = Arc::new(
            ReqwestTransport::new(ReqwestOptions {
                api_key_source: ApiKeySource::Inline { value: key },
                ..ReqwestOptions::default()
            })
            .map_err(novelai_bridge::BridgeError::from)?,
        );
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

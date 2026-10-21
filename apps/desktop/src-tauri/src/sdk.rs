//! Host-owned SDK clients share tokenizers and account state until credentials change.

use std::sync::{Arc, Mutex};

use nib_app::{
    jobs::{JobError, SdkClientProvider},
    persistence::PersistenceError,
    settings::CredentialStore as _,
};
use novelai_bridge::{
    ApiKeySource, Client, ClientConfig, CreditEvent, CreditObserver, ReqwestOptions,
    ReqwestTransport, SecretString, Tokenizers, Transport,
};
use secrecy::ExposeSecret as _;

use crate::credentials::NativeCredentials;

struct CachedClient {
    key: SecretString,
    client: Client<dyn Transport>,
}

pub(crate) struct SdkClients {
    credentials: Arc<NativeCredentials>,
    tokenizers: Arc<Tokenizers>,
    cached: Mutex<Option<CachedClient>>,
}

impl SdkClients {
    pub(crate) fn new(credentials: Arc<NativeCredentials>, tokenizers: Arc<Tokenizers>) -> Self {
        Self {
            credentials,
            tokenizers,
            cached: Mutex::new(None),
        }
    }

    pub(crate) fn invalidate(&self) -> Result<(), JobError> {
        *self
            .cached
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)? = None;
        Ok(())
    }

    pub(crate) fn tokenizers(&self) -> Arc<Tokenizers> { Arc::clone(&self.tokenizers) }
}

impl SdkClientProvider for SdkClients {
    fn client(&self) -> Result<Client<dyn Transport>, JobError> {
        let key = self
            .credentials
            .load()?
            .ok_or(JobError::MissingCredentials)?;
        let mut cached = self
            .cached
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if let Some(existing) = cached.as_ref()
            && existing.key.expose_secret() == key.expose_secret()
        {
            return Ok(existing.client.clone());
        }
        let transport = ReqwestTransport::new(ReqwestOptions {
            api_key_source: ApiKeySource::Inline { value: key.clone() },
            ..ReqwestOptions::default()
        })
        .map_err(novelai_bridge::BridgeError::from)?;
        let transport: Arc<dyn Transport> = Arc::new(transport);
        let client = Client::new(transport, ClientConfig::default())
            .with_tokenizers(Arc::clone(&self.tokenizers))
            .with_credit_observer(Arc::new(CreditDiagnostics));
        *cached = Some(CachedClient {
            key,
            client: client.clone(),
        });
        Ok(client)
    }

    fn cached_client(&self) -> Option<Client<dyn Transport>> {
        self.cached
            .lock()
            .ok()?
            .as_ref()
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

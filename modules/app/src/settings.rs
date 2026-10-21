//! Account credentials stay in a host-owned secret backend.

use std::error::Error;

use novelai_bridge::SecretString;
use serde::{Deserialize, Serialize};

/// Only credential presence crosses the application boundary.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct AccountStatus {
    pub configured: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum CredentialError {
    #[error("{operation}")]
    Failure {
        operation: &'static str,
        #[source]
        source: Box<dyn Error + Send + Sync>,
    },
    #[error("the API key must be a nonempty HTTP header value")]
    InvalidKey,
    #[error("the system credential store is unavailable after an interrupted operation")]
    Locked,
}

impl CredentialError {
    /// Retains native diagnostics; callers must never attach secret-derived errors.
    pub fn failure(operation: &'static str, source: impl Error + Send + Sync + 'static) -> Self {
        Self::Failure {
            operation,
            source: Box::new(source),
        }
    }
}

/// The desktop host selects the native credential backend.
pub trait CredentialStore: Send + Sync {
    /// Reads the selected account's API key.
    ///
    /// # Errors
    /// Returns a backend failure without secret material in its diagnostics.
    fn load(&self) -> Result<Option<SecretString>, CredentialError>;

    /// Replaces the selected account's API key.
    ///
    /// # Errors
    /// Returns a backend failure without secret material in its diagnostics.
    fn save(&self, secret: SecretString) -> Result<(), CredentialError>;

    /// Removes the selected account's API key; absence is already success.
    ///
    /// # Errors
    /// Returns a backend failure without secret material in its diagnostics.
    fn delete(&self) -> Result<(), CredentialError>;
}

/// Uses the SDK's own credential/header boundary without contacting the service.
///
/// # Errors
/// Returns `InvalidKey` for a credential rejected by the SDK transport constructor.
pub fn validate_api_key(secret: &SecretString) -> Result<(), CredentialError> {
    novelai_bridge::ReqwestTransport::new(novelai_bridge::ReqwestOptions {
        api_key_source: novelai_bridge::ApiKeySource::Inline {
            value: secret.clone(),
        },
        ..novelai_bridge::ReqwestOptions::default()
    })
    .map(|_| ())
    .map_err(|_invalid_header| CredentialError::InvalidKey)
}

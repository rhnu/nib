//! Global application preferences and host-owned account credentials.

mod sqlite;

use std::error::Error;

use novelai_bridge::SecretString;
use serde::{Deserialize, Serialize};
pub use sqlite::{DataDirectories, GlobalSettingsStore};

/// The application-wide appearance, synchronized with the desktop host.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum Theme {
    #[default]
    Dark,
    Light,
}

/// Global preferences remain independent of the selected data directory.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ApplicationPreferences {
    pub theme: Theme,
}

/// Resolved host directories displayed by the storage settings screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct StorageLocations {
    pub config_directory: String,
    pub data_directory: String,
    pub pending_data_directory: Option<String>,
    pub default_data_directory: String,
    pub development: bool,
}

/// Global preferences and storage locations synchronized at application startup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ApplicationSettingsSnapshot {
    pub preferences: ApplicationPreferences,
    pub storage: StorageLocations,
}

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

/// Deliberately selected account fields; original provider responses never cross IPC.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct AccountSummary {
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub sampled_at: Option<i64>,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub anlas_balance: i64,
    pub subscription_active: bool,
    pub tier: i32,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub expires_at_ms: Option<i64>,
    pub v5_usage: Option<AllowanceSummary>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct AllowanceSummary {
    pub is_negative: bool,
    pub percent: u32,
    pub purchased_percent: u32,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub seconds_until_next_percent: u64,
}

impl From<&novelai_bridge::SubscriptionInfo> for AccountSummary {
    fn from(info: &novelai_bridge::SubscriptionInfo) -> Self {
        Self {
            sampled_at: None,
            anlas_balance: info.anlas_balance,
            subscription_active: info.subscription_active,
            tier: info.tier,
            expires_at_ms: info.expires_at_ms,
            v5_usage: info.v5_usage.map(|usage| AllowanceSummary {
                is_negative: usage.is_negative,
                percent: usage.percent,
                purchased_percent: usage.purchased_percent,
                seconds_until_next_percent: usage.seconds_until_next_percent,
            }),
        }
    }
}

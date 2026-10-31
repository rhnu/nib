//! Global application preferences and host-owned account credentials.

use crate::api::UserMessage;

mod accounts;
pub use accounts::{AccountError, activate_account, delete_account, save_account};
mod sqlite;

use std::error::Error;

use novelai_bridge::SecretString;
use serde::{Deserialize, Serialize};
pub use sqlite::{DataDirectories, GlobalSettingsStore};

/// Host-owned directory access and relocation I/O, coordinated by application state.
pub trait StorageBackend: Send + Sync {
    /// Locks and resolves the current creation-data directory before opening retained data.
    /// # Errors
    /// Returns directory, configuration or exclusive-access failures.
    fn data_directory(&self) -> Result<std::path::PathBuf, crate::persistence::PersistenceError>;

    /// Returns configured locations without opening the creation database.
    /// # Errors
    /// Returns configuration or path-display failures.
    fn locations(&self) -> Result<StorageLocations, crate::persistence::PersistenceError>;

    /// Copies and verifies retained data after the application has drained all writers.
    /// # Errors
    /// Returns relocation failures without publishing an incomplete target.
    fn migrate_directory(
        &self,
        directory: Option<&std::path::Path>,
    ) -> Result<StorageLocations, crate::persistence::PersistenceError>;
}

/// The application-wide appearance, synchronized with the desktop host.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum Theme {
    #[default]
    Dark,
    Light,
}

/// User language preference; the frontend resolves system through the host locale.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum Language {
    #[default]
    #[serde(rename = "system")]
    System,
    #[serde(rename = "en")]
    En,
    #[serde(rename = "zh-CN")]
    ZhCn,
}

/// Global preferences remain independent of the selected data directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ApplicationPreferences {
    pub theme: Theme,
    pub language: Language,
    pub recent_image_limit: u32,
    pub execution: ExecutionPreferences,
    pub safety: crate::safety::SafetyPreferences,
}

impl Default for ApplicationPreferences {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            language: Language::default(),
            execution: ExecutionPreferences::default(),
            safety: crate::safety::SafetyPreferences::default(),
            recent_image_limit: 20,
        }
    }
}

/// Host transport choices captured independently from creative inputs at submission.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ExecutionPreferences {
    /// Absence uses the SDK default for image operations and account/tag queries.
    pub image_base_url: Option<String>,
    pub image_request_encoding: ImageRequestEncoding,
    pub server_image_cache: bool,
}

/// Persisted projection of the SDK's image request encoding option.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ImageRequestEncoding {
    #[default]
    Json,
    Multipart,
}

impl ExecutionPreferences {
    pub fn client_config(&self) -> novelai_bridge::ClientConfig {
        novelai_bridge::ClientConfig {
            image_base_url: self
                .image_base_url
                .clone()
                .unwrap_or_else(|| novelai_bridge::ClientConfig::default().image_base_url),
            image_request_encoding: match self.image_request_encoding {
                ImageRequestEncoding::Json => novelai_bridge::ImageRequestEncoding::Json,
                ImageRequestEncoding::Multipart => novelai_bridge::ImageRequestEncoding::Multipart,
            },
            image_cache: self
                .server_image_cache
                .then(novelai_bridge::ImageCacheConfig::default),
            ..novelai_bridge::ClientConfig::default()
        }
    }
}

/// Resolved host directories displayed by the storage settings screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct StorageLocations {
    pub config_directory: String,
    pub data_directory: String,
    pub relocated_data_directory: Option<String>,
    pub default_data_directory: String,
    pub development: bool,
    pub restart_required: bool,
}

/// Global preferences and storage locations synchronized at application startup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ApplicationSettingsSnapshot {
    pub preferences: ApplicationPreferences,
    pub storage: StorageLocations,
}

/// Account names and selection cross IPC while keys remain in the native store.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct AccountStatus {
    pub configured: bool,
    pub active_id: Option<String>,
    pub credentials: Vec<CredentialProfile>,
}

/// Named account metadata; the secret itself only exists in the native keyring.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct CredentialProfile {
    pub id: String,
    pub name: String,
}

/// Current sampling state for the active immutable credential version and endpoint.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct AccountSnapshot {
    pub summary: Option<AccountSummary>,
    pub refreshing: bool,
    pub stale: bool,
    pub error: Option<UserMessage>,
    pub revision: u32,
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
    /// Reads the immutable credential identity selected for future operations.
    ///
    /// # Errors
    /// Returns a backend failure without secret material in its diagnostics.
    fn active_id(&self) -> Result<Option<String>, CredentialError>;

    /// Reads exactly the requested immutable version; absence never selects another key.
    ///
    /// # Errors
    /// Returns a backend failure without secret material in its diagnostics.
    fn load(&self, id: &str) -> Result<Option<SecretString>, CredentialError>;

    /// Saves a key under a newly allocated immutable version identity.
    ///
    /// # Errors
    /// Returns a backend failure without secret material in its diagnostics.
    fn save(&self, id: &str, secret: SecretString) -> Result<(), CredentialError>;

    /// Removes one immutable version; absence is already success.
    ///
    /// # Errors
    /// Returns a backend failure without secret material in its diagnostics.
    fn delete(&self, id: &str) -> Result<(), CredentialError>;
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
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
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

/// One explicit sample keeps SDK account content and its observation time inseparable.
#[derive(Clone)]
pub struct AccountSample {
    pub subscription: novelai_bridge::SubscriptionInfo,
    pub sampled_at: i64,
}

impl AccountSample {
    #[must_use]
    pub fn summary(&self) -> AccountSummary {
        AccountSummary {
            sampled_at: Some(self.sampled_at),
            ..AccountSummary::from(&self.subscription)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
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

#[cfg(test)]
mod tests;

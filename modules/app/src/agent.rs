//! A cloud assistant that edits through existing application capabilities.

use serde::{Deserialize, Serialize};

#[cfg(feature = "native")]
mod runtime;
#[cfg(feature = "native")]
pub(crate) mod storage;
#[cfg(feature = "native")]
mod tools;
#[cfg(feature = "native")]
pub use runtime::AgentRuntime;

/// The selected wire protocol, independent of the compatible service's hostname.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum AgentApi {
    ChatCompletions,
    Responses,
}

/// Nonsecret connection metadata. Endpoint is the API root, usually ending in `/v1`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct AgentConnectionConfig {
    pub endpoint: String,
    pub model: String,
    pub api: AgentApi,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct AgentConnectionStatus {
    pub config: Option<AgentConnectionConfig>,
    pub configured: bool,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum AgentRunStatus {
    #[default]
    Idle,
    Running,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct AgentMessage {
    pub id: String,
    /// `user`, `assistant`, or `tool`; no provider payload crosses IPC.
    pub role: String,
    pub content: String,
    pub tool_name: Option<String>,
    pub success: Option<bool>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct AgentSnapshot {
    pub run_id: Option<String>,
    pub status: AgentRunStatus,
    pub messages: Vec<AgentMessage>,
    pub error: Option<String>,
    #[serde(default)]
    pub resources_undo_available: bool,
}

/// Deliberate safe errors. Provider bodies and transport URLs never become user diagnostics.
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("{0}")]
    Invalid(&'static str),
    #[error("the assistant is already running")]
    Busy,
    #[error("configure an assistant connection and API key first")]
    Unconfigured,
    #[error(
        "the assistant request failed; check the endpoint, model, API key and service availability"
    )]
    Provider,
    #[error("the assistant provider returned HTTP {0}")]
    ProviderStatus(u16),
    #[error("the assistant run exceeded its time or model-call budget")]
    Limit,
    #[error("the assistant was cancelled")]
    Cancelled,
    #[error("the assistant state is unavailable")]
    Locked,
    #[error(transparent)]
    Persistence(#[from] crate::persistence::PersistenceError),
    #[error("the system credential store could not complete the operation")]
    Credentials(#[from] crate::settings::CredentialError),
}

impl AgentError {
    #[must_use]
    pub fn safe_message(&self) -> &str {
        match self {
            Self::Invalid(message) => message,
            Self::Busy => "The assistant is already running.",
            Self::Unconfigured => "Configure an assistant connection and API key first.",
            Self::Provider => {
                "The assistant request failed. Check the endpoint, model, API key and service availability."
            },
            Self::ProviderStatus(401 | 403) => {
                "The assistant provider rejected the API key or its permissions (HTTP 401/403)."
            },
            Self::ProviderStatus(429) => {
                "The assistant provider rate limit or quota was reached (HTTP 429)."
            },
            Self::ProviderStatus(_) => "The assistant provider returned an HTTP error.",
            Self::Limit => {
                "The assistant stopped at its time, output or model-call limit. Completed changes were retained."
            },
            Self::Cancelled => "The assistant was cancelled. Completed changes have been retained.",
            Self::Locked => "The assistant state is unavailable.",
            Self::Persistence(_) => "The assistant could not read or save local data.",
            Self::Credentials(_) => "The system credential store could not complete the operation.",
        }
    }

    #[must_use]
    pub fn is_conflict(&self) -> bool {
        matches!(
            self,
            Self::Busy | Self::Persistence(crate::persistence::PersistenceError::Conflict { .. })
        )
    }
}

#[cfg(test)]
mod tests;

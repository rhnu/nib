//! Global assistant configuration, independent of creation data and chat initialization.
use std::sync::{Arc, Mutex};

use secrecy::ExposeSecret as _;

use super::{
    AgentConnectionConfig, AgentConnectionStatus, AgentError, AgentProvider,
    storage::ConnectionMetadata,
};
use crate::settings::{CredentialStore, GlobalSettingsStore};

/// Host platform adjustments for spawned MCP servers (for example hidden Windows consoles).
pub type ConfigureMcpCommand = fn(&mut tokio::process::Command);
/// Records actual tool outcomes in the active conversation.
pub type ExtensionRecorder = Arc<
    dyn Fn(&str, bool, rig_core::tool::ToolOutput) -> Result<rig_core::tool::ToolOutput, AgentError>
        + Send
        + Sync,
>;
/// Admits a tool and holds its activity until its result has been recorded.
pub type ExtensionAdmit = Arc<dyn Fn() -> Result<Box<dyn Send>, AgentError> + Send + Sync>;

/// Global configuration and native secrets; does not open creation data.
pub struct AgentConfiguration {
    pub(crate) settings: Arc<GlobalSettingsStore>,
    pub(crate) credentials: Arc<dyn CredentialStore>,
    pub(crate) connection_change: Mutex<()>,
    pub(crate) configure_command: ConfigureMcpCommand,
}

impl AgentConfiguration {
    #[must_use]
    pub fn new(
        settings: Arc<GlobalSettingsStore>,
        credentials: Arc<dyn CredentialStore>,
        configure_command: ConfigureMcpCommand,
    ) -> Self {
        Self {
            settings,
            credentials,
            connection_change: Mutex::new(()),
            configure_command,
        }
    }

    /// Captures one complete connection and key revision before starting a run.
    /// # Errors
    /// Returns missing credentials, configuration failures, or an unavailable lock.
    pub fn run_connection(
        &self,
    ) -> Result<(AgentConnectionConfig, novelai_bridge::SecretString), AgentError> {
        let _guard = self
            .connection_change
            .lock()
            .map_err(|_error| AgentError::Locked)?;
        let metadata = self
            .settings
            .agent_connection()?
            .ok_or(AgentError::Unconfigured)?;
        let secret = self
            .credentials
            .load(&metadata.secret_id)?
            .ok_or(AgentError::Unconfigured)?;
        Ok((metadata.config, secret))
    }

    /// Reads connection metadata and native credential availability.
    /// # Errors
    /// Returns settings or native credential access failures.
    pub fn connection(&self) -> Result<AgentConnectionStatus, AgentError> {
        let metadata = self.settings.agent_connection()?;
        let configured = match &metadata {
            Some(metadata) => self.credentials.load(&metadata.secret_id)?.is_some(),
            None => false,
        };
        Ok(AgentConnectionStatus {
            config: metadata.map(|value| value.config),
            configured,
            generation_permission: self.settings.agent_permission()?,
        })
    }

    /// Lists models using the current form endpoint and a new key, or the same saved endpoint's key.
    /// # Errors
    /// Returns invalid endpoint, missing credentials, or provider failures.
    pub async fn models(
        &self,
        provider: AgentProvider,
        api_key: Option<String>,
    ) -> Result<Vec<String>, AgentError> {
        let provider = normalize_provider(provider)?;
        let secret = if let Some(key) = api_key.filter(|key| !key.trim().is_empty()) {
            let key = novelai_bridge::SecretString::from(key);
            crate::settings::validate_api_key(&key)?;
            key
        } else {
            let metadata = self
                .settings
                .agent_connection()?
                .ok_or(AgentError::Unconfigured)?;
            if provider.endpoint() != metadata.config.provider.endpoint() {
                return Err(AgentError::Invalid(
                    "Enter the API key for this endpoint before loading models.",
                ));
            }
            self.credentials
                .load(&metadata.secret_id)?
                .ok_or(AgentError::Unconfigured)?
        };
        let provider =
            super::connection::provider(provider.endpoint(), secret.expose_secret().to_owned())
                .client();
        let models =
            tokio::time::timeout(std::time::Duration::from_secs(30), provider.list_models())
                .await
                .map_err(|_error| AgentError::Provider)?
                .map_err(|_error| AgentError::Provider)?;
        let mut ids: Vec<_> = models.data.into_iter().map(|model| model.id).collect();
        ids.sort();
        ids.dedup();
        tracing::debug!(count = ids.len(), "assistant models loaded");
        Ok(ids)
    }

    /// Saves the user's paid-generation policy independently of provider credentials.
    /// # Errors
    /// Returns configuration storage failures.
    pub fn save_permission(
        &self,
        permission: super::AgentPermission,
    ) -> Result<AgentConnectionStatus, AgentError> {
        self.settings.save_agent_permission(permission)?;
        tracing::info!(?permission, "assistant generation permission saved");
        self.connection()
    }

    /// Saves the key in the native credential store before publishing only its opaque identity.
    /// # Errors
    /// Returns invalid metadata, a missing key, or settings/native credential failures.
    pub fn save_connection(
        &self,
        config: AgentConnectionConfig,
        api_key: Option<String>,
    ) -> Result<AgentConnectionStatus, AgentError> {
        let _change = self
            .connection_change
            .lock()
            .map_err(|_error| AgentError::Locked)?;
        let config = normalize_connection(config)?;
        let previous = self.settings.agent_connection()?;
        let key = api_key.filter(|key| !key.trim().is_empty());
        let metadata = if let Some(key) = key {
            let secret = novelai_bridge::SecretString::from(key);
            crate::settings::validate_api_key(&secret)?;
            let id = format!("agent-{}", uuid::Uuid::new_v4());
            self.credentials.save(&id, secret)?;
            let metadata = ConnectionMetadata {
                config,
                secret_id: id.clone(),
            };
            if let Err(error) = self.settings.save_agent_connection(&metadata) {
                if self.credentials.delete(&id).is_err() {
                    tracing::warn!("failed to remove an unpublished assistant key");
                }
                return Err(error.into());
            }
            metadata
        } else {
            let previous = previous.as_ref().ok_or(AgentError::Unconfigured)?;
            // A saved key is never silently forwarded to a different host or API path.
            if previous.config.provider.endpoint() != config.provider.endpoint() {
                return Err(AgentError::Invalid(
                    "Changing the assistant endpoint requires entering its API key again.",
                ));
            }
            let metadata = ConnectionMetadata {
                config,
                secret_id: previous.secret_id.clone(),
            };
            self.settings.save_agent_connection(&metadata)?;
            metadata
        };
        if let Some(previous) = previous
            && previous.secret_id != metadata.secret_id
        {
            // Runs load their key before starting; no future lookup needs this old version.
            self.credentials.delete(&previous.secret_id)?;
        }
        tracing::info!(api = ?metadata.config.provider.api(), "assistant connection saved");
        self.connection()
    }

    /// Builds enabled MCP tools and on-demand skill readers for this run.
    /// # Errors
    /// Returns invalid enabled extensions, missing secrets, or connection failures.
    pub async fn runtime_tools(
        self: &Arc<Self>,
        recorder: ExtensionRecorder,
        admit: ExtensionAdmit,
    ) -> Result<Vec<rig_core::tool::DynamicTool>, ExtensionError> {
        let mut tools =
            super::mcp::runtime_tools(self, Arc::clone(&recorder), Arc::clone(&admit)).await?;
        tools.extend(super::skills::runtime_tools(self, &recorder, &admit));
        Ok(tools)
    }
}

/// Extension errors preserve their cause internally; IPC uses the safe outer message.
#[derive(Debug, thiserror::Error)]
pub enum ExtensionError {
    #[error("{0}")]
    Invalid(&'static str),
    #[error("the extension configuration is unavailable")]
    Locked,
    #[error("extension configuration storage failed")]
    Persistence(#[from] crate::persistence::PersistenceError),
    #[error("the extension system credential operation failed")]
    Credentials(#[from] crate::settings::CredentialError),
    #[error("the extension operation failed: {operation}")]
    Failure {
        operation: &'static str,
        #[source]
        source: anyhow::Error,
    },
}

impl ExtensionError {
    pub(crate) fn failure(operation: &'static str, source: impl Into<anyhow::Error>) -> Self {
        Self::Failure {
            operation,
            source: source.into(),
        }
    }

    /// Safe IPC diagnostic; nested errors can contain credentials supplied by a server.
    #[must_use]
    pub fn safe_message(&self) -> &'static str {
        match self {
            Self::Invalid(message) => message,
            Self::Locked => "Extension configuration is unavailable.",
            Self::Persistence(_) => "Extension configuration storage failed.",
            Self::Credentials(_) => "Extension system credential operation failed.",
            Self::Failure { operation, .. } => operation,
        }
    }
}

pub(super) fn normalize_connection(
    mut config: AgentConnectionConfig,
) -> Result<AgentConnectionConfig, AgentError> {
    config.provider = normalize_provider(config.provider)?;
    config.model = config.model.trim().to_owned();
    if config.model.is_empty() || config.model.len() > 256 {
        return Err(AgentError::Invalid(
            "Enter an assistant model name of at most 256 bytes.",
        ));
    }
    Ok(config)
}

pub(super) fn normalize_provider(mut provider: AgentProvider) -> Result<AgentProvider, AgentError> {
    let AgentProvider::Custom { endpoint, .. } = &mut provider else {
        return Ok(provider);
    };
    *endpoint = endpoint.trim().trim_end_matches('/').to_owned();
    let url = reqwest::Url::parse(endpoint)
        .map_err(|_error| AgentError::Invalid("Enter an absolute HTTPS assistant API root."))?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AgentError::Invalid(
            "The assistant API root must be HTTP(S), without credentials, query parameters or a fragment.",
        ));
    }
    Ok(provider)
}

/// Owns admitted activity across blocking result persistence, including caller cancellation.
pub(crate) async fn record_extension(
    recorder: ExtensionRecorder,
    activity: Box<dyn Send>,
    name: String,
    success: bool,
    output: rig_core::tool::ToolOutput,
) -> Result<rig_core::tool::ToolOutput, rig_core::tool::ToolExecutionError> {
    use rig_core::tool::ToolExecutionError;
    tokio::task::spawn_blocking(move || {
        let _activity = activity;
        recorder(&name, success, output)
    })
    .await
    .map_err(|error| {
        ToolExecutionError::other("Extension result persistence task failed.").with_source(error)
    })?
    .map_err(|error| ToolExecutionError::other(error.safe_message()).with_source(error))
}

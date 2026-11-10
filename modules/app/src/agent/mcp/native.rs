use std::{sync::Arc, time::Duration};

use rig_core::{
    message::ToolName,
    tool::{DynamicTool, ToolExecutionError, ToolOutput},
};
use rmcp::{
    ServiceExt as _,
    model::ClientConfig,
    transport::{
        StreamableHttpClientTransport, TokioChildProcess,
        streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use secrecy::ExposeSecret as _;
use serde::{Deserialize, Serialize};

use super::{McpConnectionTest, McpSecrets, McpServerConfig, McpServerStatus, McpTransport};
use crate::agent::configuration::{
    AgentConfiguration, ExtensionAdmit, ExtensionError, ExtensionRecorder,
};

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct StoredServer {
    pub config: McpServerConfig,
    pub secret_id: Option<String>,
}

impl McpSecrets {
    fn is_empty(&self) -> bool {
        self.bearer_token.as_ref().is_none_or(String::is_empty)
            && self.headers.is_empty()
            && self.env.is_empty()
    }
}

impl AgentConfiguration {
    /// Lists metadata without exposing header, bearer, or environment values.
    /// # Errors
    /// Returns configuration storage failures.
    pub fn mcp_servers(&self) -> Result<Vec<McpServerStatus>, ExtensionError> {
        Ok(self
            .settings
            .agent_mcp()?
            .into_iter()
            .map(|s| McpServerStatus {
                config: s.config,
                has_secrets: s.secret_id.is_some(),
            })
            .collect())
    }

    /// Saves a server; absent secrets preserve the old values for the same destination.
    /// # Errors
    /// Returns invalid metadata, credential failures, or storage failures.
    pub fn save_mcp_server(
        &self,
        mut config: McpServerConfig,
        secrets: Option<McpSecrets>,
    ) -> Result<Vec<McpServerStatus>, ExtensionError> {
        let _guard = self
            .connection_change
            .lock()
            .map_err(|_error| ExtensionError::Locked)?;
        if config.id.is_empty() {
            config.id = uuid::Uuid::new_v4().to_string();
        }
        validate(&config)?;
        let mut servers = self.settings.agent_mcp()?;
        let index = servers.iter().position(|s| s.config.id == config.id);
        let previous = index.map(|i| servers[i].clone());
        if secrets.is_none()
            && previous.as_ref().is_some_and(|s| {
                s.secret_id.is_some() && destination(&s.config) != destination(&config)
            })
        {
            return Err(ExtensionError::Invalid(
                "Re-enter secrets when changing an MCP destination.",
            ));
        }
        let secret_id = if let Some(mut secrets) = secrets {
            secrets.bearer_token = secrets.bearer_token.filter(|token| !token.is_empty());
            validate_secrets(&secrets)?;
            if secrets.is_empty() {
                None
            } else {
                let encoded = serde_json::to_string(&secrets)
                    .map_err(|e| ExtensionError::failure("encode MCP credentials", e))?;
                let id = format!("mcp-{}", uuid::Uuid::new_v4());
                self.credentials
                    .save(&id, novelai_bridge::SecretString::from(encoded))?;
                Some(id)
            }
        } else {
            previous.as_ref().and_then(|s| s.secret_id.clone())
        };
        let server = StoredServer {
            config,
            secret_id: secret_id.clone(),
        };
        if let Some(i) = index {
            servers[i] = server;
        } else {
            servers.push(server);
        }
        if let Err(error) = self.settings.save_agent_mcp(&servers) {
            if previous.as_ref().and_then(|s| s.secret_id.as_ref()) != secret_id.as_ref()
                && let Some(id) = &secret_id
                && let Err(cleanup) = self.credentials.delete(id)
            {
                tracing::warn!(error = %cleanup, "failed to remove unpublished MCP credentials");
            }
            return Err(error.into());
        }
        if let Some(old) = previous.and_then(|s| s.secret_id)
            && Some(&old) != secret_id.as_ref()
        {
            self.credentials.delete(&old)?;
        }
        tracing::info!("MCP server configuration saved");
        self.mcp_servers()
    }

    /// Removes registration before deleting its native secret.
    /// # Errors
    /// Returns invalid identity, storage or credential failures.
    pub fn remove_mcp_server(&self, id: &str) -> Result<Vec<McpServerStatus>, ExtensionError> {
        let _guard = self
            .connection_change
            .lock()
            .map_err(|_error| ExtensionError::Locked)?;
        let mut servers = self.settings.agent_mcp()?;
        let index = servers
            .iter()
            .position(|s| s.config.id == id)
            .ok_or(ExtensionError::Invalid("MCP server not found."))?;
        let old = servers.remove(index);
        self.settings.save_agent_mcp(&servers)?;
        if let Some(id) = old.secret_id {
            self.credentials.delete(&id)?;
        }
        self.mcp_servers()
    }

    /// Connects and lists the server's actual tools, then closes the test connection.
    /// # Errors
    /// Returns missing configuration, credential, transport or timeout failures.
    pub async fn test_mcp_server(&self, id: &str) -> Result<McpConnectionTest, ExtensionError> {
        let (server, secret) = {
            let _guard = self
                .connection_change
                .lock()
                .map_err(|_error| ExtensionError::Locked)?;
            let server = self
                .settings
                .agent_mcp()?
                .into_iter()
                .find(|s| s.config.id == id)
                .ok_or(ExtensionError::Invalid("MCP server not found."))?;
            let secret = secrets(self, &server)?;
            (server, secret)
        };
        let hidden = hidden_values(&secret);
        let connection = connect(self, &server, secret).await?;
        let result = tool_list(&connection, server.config.connection_timeout_ms, &hidden).await;
        if let Err(error) = tokio::time::timeout(
            Duration::from_millis(u64::from(server.config.connection_timeout_ms)),
            connection.close(),
        )
        .await
        {
            if result.is_ok() {
                return Err(ExtensionError::failure(
                    "Close the MCP test connection.",
                    error,
                ));
            }
            tracing::warn!(%error, "closing MCP test connection timed out after tool discovery failed");
        }
        Ok(McpConnectionTest {
            tool_names: result?
                .into_iter()
                .map(|t| {
                    let mut name = t.name().to_owned();
                    redact_text(&mut name, &hidden);
                    name
                })
                .collect(),
        })
    }
}

fn destination(config: &McpServerConfig) -> String {
    match &config.transport {
        McpTransport::Http { url } => url.clone(),
        McpTransport::Stdio { command, args, cwd } => format!("{command:?}{args:?}{cwd:?}"),
    }
}

fn validate(config: &McpServerConfig) -> Result<(), ExtensionError> {
    if uuid::Uuid::parse_str(&config.id).is_err()
        || config.name.trim().is_empty()
        || config.name.len() > 256
        || !(100..=600_000).contains(&config.connection_timeout_ms)
        || !(100..=3_600_000).contains(&config.call_timeout_ms)
    {
        return Err(ExtensionError::Invalid(
            "Enter a server name, valid identity and timeouts (connection 100–600000 ms; call 100–3600000 ms).",
        ));
    }
    match &config.transport {
        McpTransport::Http { url } => {
            let url = reqwest::Url::parse(url)
                .map_err(|e| ExtensionError::failure("parse MCP URL", e))?;
            if url.scheme() != "https"
                || url.host_str().is_none()
                || !url.username().is_empty()
                || url.password().is_some()
                || url.fragment().is_some()
                || url.query().is_some()
            {
                return Err(ExtensionError::Invalid(
                    "MCP requires an HTTPS URL without credentials, query or fragment; use secret headers for authentication.",
                ));
            }
        },
        McpTransport::Stdio { command, cwd, .. } => {
            if command.trim().is_empty()
                || cwd
                    .as_ref()
                    .is_some_and(|p| !std::path::Path::new(p).is_absolute())
            {
                return Err(ExtensionError::Invalid(
                    "Enter a command and an absolute working directory when supplied.",
                ));
            }
        },
    }
    Ok(())
}

fn validate_secrets(secrets: &McpSecrets) -> Result<(), ExtensionError> {
    if secrets.bearer_token.is_some()
        && secrets
            .headers
            .keys()
            .any(|name| name.eq_ignore_ascii_case("authorization"))
    {
        return Err(ExtensionError::Invalid(
            "Use either a bearer token or an Authorization header.",
        ));
    }
    for (name, value) in &secrets.headers {
        reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|e| ExtensionError::failure("parse MCP header name", e))?;
        reqwest::header::HeaderValue::from_str(value)
            .map_err(|e| ExtensionError::failure("parse MCP header value", e))?;
        if [
            "host",
            "content-length",
            "content-type",
            "accept",
            "mcp-session-id",
            "mcp-protocol-version",
        ]
        .contains(&name.to_ascii_lowercase().as_str())
        {
            return Err(ExtensionError::Invalid(
                "MCP protocol headers cannot be overridden.",
            ));
        }
    }
    if secrets
        .env
        .iter()
        .any(|(name, value)| name.is_empty() || name.contains(['=', '\0']) || value.contains('\0'))
    {
        return Err(ExtensionError::Invalid("Invalid MCP environment variable."));
    }
    if let Some(token) = &secrets.bearer_token {
        reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|e| ExtensionError::failure("parse MCP bearer token", e))?;
    }
    Ok(())
}

fn secrets(
    configuration: &AgentConfiguration,
    server: &StoredServer,
) -> Result<McpSecrets, ExtensionError> {
    match &server.secret_id {
        None => Ok(McpSecrets::default()),
        Some(id) => {
            let secret = configuration
                .credentials
                .load(id)?
                .ok_or(ExtensionError::Invalid(
                    "Saved MCP credentials are missing; enter them again.",
                ))?;
            serde_json::from_str(secret.expose_secret())
                .map_err(|e| ExtensionError::failure("decode MCP credentials", e))
        },
    }
}

fn snapshots(
    configuration: &AgentConfiguration,
) -> Result<Vec<(StoredServer, McpSecrets)>, ExtensionError> {
    let _guard = configuration
        .connection_change
        .lock()
        .map_err(|_error| ExtensionError::Locked)?;
    configuration
        .settings
        .agent_mcp()?
        .into_iter()
        .filter(|s| s.config.enabled)
        .map(|server| {
            let secret = secrets(configuration, &server)?;
            Ok((server, secret))
        })
        .collect()
}

fn hidden_values(secret: &McpSecrets) -> Vec<String> {
    let mut values: Vec<String> = secret
        .headers
        .values()
        .chain(secret.env.values())
        .chain(secret.bearer_token.iter())
        .filter(|v| !v.is_empty())
        .cloned()
        .collect();
    values.sort_by_key(|value| std::cmp::Reverse(value.len()));
    values.dedup();
    values
}

async fn connect(
    configuration: &AgentConfiguration,
    server: &StoredServer,
    secret: McpSecrets,
) -> Result<rig_rmcp::McpConnection, ExtensionError> {
    let hidden = hidden_values(&secret);
    validate(&server.config)
        .inspect_err(|error| log_failure("validate MCP connection", error, &hidden))?;
    let operation = async {
        match &server.config.transport {
            McpTransport::Http { url } => {
                let mut config = StreamableHttpClientTransportConfig::with_uri(url.clone());
                config.auth_header = secret.bearer_token;
                for (name, value) in secret.headers {
                    let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                        .map_err(|e| ExtensionError::failure("parse MCP header", e))?;
                    let value = reqwest::header::HeaderValue::from_str(&value)
                        .map_err(|e| ExtensionError::failure("parse MCP header", e))?;
                    config.custom_headers.insert(name, value);
                }
                let client = reqwest::Client::builder()
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .map_err(|e| ExtensionError::failure("build MCP HTTP client", e))?;
                let transport = StreamableHttpClientTransport::with_client(client, config);
                let service = ClientConfig::default()
                    .serve(transport)
                    .await
                    .map_err(|e| ExtensionError::failure("connect MCP HTTP server", e))?;
                Ok(rig_rmcp::McpConnection::new(service))
            },
            McpTransport::Stdio { command, args, cwd } => {
                let mut command = tokio::process::Command::new(command);
                command.args(args).envs(secret.env).kill_on_drop(true);
                if let Some(cwd) = cwd {
                    command.current_dir(cwd);
                }
                (configuration.configure_command)(&mut command);
                let (transport, stderr) = TokioChildProcess::builder(command)
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .map_err(|e| ExtensionError::failure("start MCP process", e))?;
                if let Some(stderr) = stderr {
                    let server_id = server.config.id.clone();
                    let stderr_hidden = hidden.clone();
                    tokio::spawn(async move {
                        use tokio::io::AsyncBufReadExt as _;
                        let mut lines = tokio::io::BufReader::new(stderr).lines();
                        loop {
                            match lines.next_line().await {
                                Ok(Some(line)) => {
                                    let mut value = serde_json::Value::String(line);
                                    redact(&mut value, &stderr_hidden);
                                    tracing::debug!(%server_id, stderr = %value, "MCP server stderr");
                                },
                                Ok(None) => break,
                                Err(error) => {
                                    tracing::warn!(%server_id, %error, "read MCP server stderr failed");
                                    break;
                                },
                            }
                        }
                    });
                }
                let service = ClientConfig::default()
                    .serve(transport)
                    .await
                    .map_err(|e| ExtensionError::failure("connect MCP process", e))?;
                Ok(rig_rmcp::McpConnection::new(service))
            },
        }
    };
    tokio::time::timeout(
        Duration::from_millis(u64::from(server.config.connection_timeout_ms)),
        operation,
    )
    .await
    .map_err(|e| ExtensionError::failure("MCP connection timed out", e))
    .and_then(std::convert::identity)
    .inspect_err(|error| log_failure("connect MCP server", error, &hidden))
}

async fn tool_list(
    connection: &rig_rmcp::McpConnection,
    timeout_ms: u32,
    hidden: &[String],
) -> Result<Vec<rig_rmcp::McpTool>, ExtensionError> {
    tokio::time::timeout(
        Duration::from_millis(u64::from(timeout_ms)),
        connection.peer().list_all_tools(),
    )
    .await
    .map_err(|e| ExtensionError::failure("MCP tool discovery timed out", e))
    .and_then(|result| result.map_err(|e| ExtensionError::failure("list MCP tools", e)))
    .inspect_err(|error| log_failure("discover MCP tools", error, hidden))
    .map(|tools| {
        tools
            .into_iter()
            .map(|definition| rig_rmcp::McpTool::new(definition, connection))
            .collect()
    })
}

pub(crate) async fn runtime_tools(
    configuration: &Arc<AgentConfiguration>,
    recorder: ExtensionRecorder,
    admit: ExtensionAdmit,
) -> Result<Vec<DynamicTool>, ExtensionError> {
    let mut tools = Vec::new();
    for (server, secret) in snapshots(configuration)? {
        let hidden = hidden_values(&secret);
        let connection = connect(configuration, &server, secret).await?;
        for tool in tool_list(&connection, server.config.connection_timeout_ms, &hidden).await? {
            use sha2::Digest as _;
            let remote_name = tool.name().to_owned();
            let hash = sha2::Sha256::digest(remote_name.as_bytes());
            let prefix = u64::from_be_bytes(hash[..8].try_into().expect("SHA-256 has 32 bytes"));
            let suffix = format!("{prefix:016x}");
            // Stable names survive server list reordering while isolating separate servers.
            let name = ToolName::new(format!(
                "mcp_{}_{}",
                server.config.id.replace('-', ""),
                suffix
            ))
            .map_err(|e| ExtensionError::failure("name MCP tool", e))?;
            let inner = DynamicTool::try_from(tool.with_name(name.clone()).with_timeout(
                Duration::from_millis(u64::from(server.config.call_timeout_ms)),
            ))
            .map_err(|e| ExtensionError::failure("adapt MCP tool", e))?;
            let definition = inner.definition();
            let display_name = format!("{} / {}", server.config.name, remote_name);
            let inner = Arc::new(inner);
            let recorder = Arc::clone(&recorder);
            let admit = Arc::clone(&admit);
            let hidden = hidden.clone();
            tools.push(DynamicTool::new(
                name.clone(),
                format!(
                    "MCP server {} / {}. {}",
                    server.config.name, remote_name, definition.description
                ),
                definition.parameters,
                move |args| {
                    let inner = Arc::clone(&inner);
                    let recorder = Arc::clone(&recorder);
                    let admit = Arc::clone(&admit);
                    let name = display_name.clone();
                    let hidden = hidden.clone();
                    Box::pin(async move {
                        let activity = admit().map_err(|e| {
                            ToolExecutionError::other(e.safe_message()).with_source(e)
                        })?;
                        match inner.run(args).await {
                            Ok(output) => {
                                let output = sanitized_output(&output, &hidden)?;
                                crate::agent::configuration::record_extension(
                                    recorder, activity, name, true, output,
                                )
                                .await
                            },
                            Err(error) => {
                                log_failure("execute MCP tool", &error, &hidden);
                                let output = sanitized_output(error.model_output(), &hidden)?;
                                let output = crate::agent::configuration::record_extension(
                                    recorder, activity, name, false, output,
                                )
                                .await?;
                                Err(ToolExecutionError::other("MCP tool failed.")
                                    .with_model_output(output)
                                    .with_source(error))
                            },
                        }
                    })
                },
            ));
        }
    }
    Ok(tools)
}

/// Logs complete available diagnostics once at the responsible MCP boundary.
fn log_failure(
    operation: &'static str,
    error: &(dyn std::error::Error + 'static),
    hidden: &[String],
) {
    use std::fmt::Write as _;
    let mut diagnostic = format!("{error:?}\n{error}");
    let mut source = error.source();
    while let Some(cause) = source {
        write!(&mut diagnostic, "\nCaused by: {cause:?}\n{cause}")
            .expect("formatting into a String cannot fail");
        source = cause.source();
    }
    // Debug escapes values such as multiline environment secrets; redact those forms too.
    for secret in hidden {
        let escaped = format!("{secret:?}");
        diagnostic = diagnostic.replace(&escaped[1..escaped.len() - 1], "[REDACTED]");
    }
    redact_text(&mut diagnostic, hidden);
    tracing::error!(operation, error = %diagnostic, "MCP operation failed");
}

fn redact(value: &mut serde_json::Value, secrets: &[String]) {
    match value {
        serde_json::Value::String(text) => {
            redact_text(text, secrets);
        },
        serde_json::Value::Array(items) => {
            for item in items {
                redact(item, secrets);
            }
        },
        serde_json::Value::Object(items) => {
            let original = std::mem::take(items);
            for (mut key, mut item) in original {
                redact_text(&mut key, secrets);
                redact(&mut item, secrets);
                items.insert(key, item);
            }
        },
        _ => {},
    }
}

fn sanitized_output(
    output: &ToolOutput,
    secrets: &[String],
) -> Result<ToolOutput, ToolExecutionError> {
    use rig_core::message::{DocumentSourceKind, ToolResultContent};
    let mut content = output.as_content().to_vec();
    for part in &mut content {
        match part {
            ToolResultContent::Text(text) => redact_text(&mut text.text, secrets),
            ToolResultContent::Json { value } => redact(value, secrets),
            ToolResultContent::Image(image) => match &mut image.data {
                DocumentSourceKind::Url(url) | DocumentSourceKind::FileId(url) => {
                    redact_text(url, secrets);
                },
                // Binary image data is never interpreted as secret-bearing text.
                DocumentSourceKind::Base64(_)
                | DocumentSourceKind::Raw(_)
                | DocumentSourceKind::Unknown => {},
            },
        }
    }
    ToolOutput::content(content)
}

fn redact_text(text: &mut String, secrets: &[String]) {
    for secret in secrets {
        *text = text.replace(secret, "[REDACTED]");
    }
}

#[cfg(test)]
mod tests;

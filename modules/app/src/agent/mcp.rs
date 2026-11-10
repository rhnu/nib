//! User-configured MCP servers and the Rig adapter for their real tools.
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Nonsecret destination and process metadata. Header and environment values live in credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum McpTransport {
    Http {
        url: String,
    },
    Stdio {
        command: String,
        args: Vec<String>,
        cwd: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub transport: McpTransport,
    pub connection_timeout_ms: u32,
    pub call_timeout_ms: u32,
}

/// Write-only complete replacement of server secrets. Omit to preserve existing secrets.
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct McpSecrets {
    pub bearer_token: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct McpServerStatus {
    pub config: McpServerConfig,
    pub has_secrets: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct McpConnectionTest {
    pub tool_names: Vec<String>,
}

#[cfg(feature = "native")]
pub(crate) mod native;
#[cfg(feature = "native")]
pub(crate) use native::runtime_tools;

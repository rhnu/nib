//! Desktop update status shared with the host; installer I/O belongs to the host.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum UpdatePhase {
    Idle,
    Checking,
    Available,
    Downloading,
    Ready,
    Installing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct UpdateRelease {
    pub version: String,
    pub notes: Option<String>,
}

/// Download bytes stay in the host, never in IPC responses or persistent creation state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct UpdateStatus {
    pub enabled: bool,
    pub current_version: String,
    pub phase: UpdatePhase,
    pub release: Option<UpdateRelease>,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub downloaded: u64,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub total: Option<u64>,
    pub error: Option<crate::api::UserMessage>,
}

//! Serializable types shared by the application and its host interfaces.

/// Application metadata displayed by the desktop client.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub default_model_id: String,
}

/// Initial workbench data; resource definitions are loaded through their own query.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct WorkspaceSnapshot {
    pub info: AppInfo,
    pub resources: Vec<crate::library::ResourceSummary>,
    pub draft: crate::session::Draft,
    pub models: Vec<String>,
}

/// Actionable error categories at the IPC boundary.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ErrorCode {
    Unavailable,
    NotFound,
    Conflict,
    Invalid,
    Unresolved,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: String,
}

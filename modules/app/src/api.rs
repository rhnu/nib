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

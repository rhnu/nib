//! Downloadable machine-local resources, independent of their consuming domains.

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum DownloadState {
    Downloading,
    Verifying,
    Activating,
    Complete,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct DownloadProgress {
    pub components: Vec<String>,
    pub state: DownloadState,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub completed_bytes: u64,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub total_bytes: u64,
    pub message: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResourceComponentStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub requires: Vec<String>,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub bytes: u64,
    pub installed: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct DownloadableResourceStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub installed_version: Option<String>,
    pub components: Vec<ResourceComponentStatus>,
    pub install: Option<DownloadProgress>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct DownloadStatus {
    pub directory: String,
    pub resources: Vec<DownloadableResourceStatus>,
    pub catalog_error: Option<String>,
}

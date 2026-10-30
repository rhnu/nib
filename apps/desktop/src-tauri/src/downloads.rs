//! Resource installation IPC accepts catalog identities and component selections only.

#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri commands own their arguments"
)]

use std::sync::Arc;

use nib_app::{
    api::{ApiError, ErrorCode, UserMessage},
    downloads::DownloadStatus,
};

use crate::state::DesktopState;

fn error(error: anyhow::Error) -> ApiError {
    ApiError {
        code: ErrorCode::Unavailable,
        message: UserMessage::External {
            detail: format!("{error:#}"),
        },
        validation_fields: Vec::new(),
    }
}

#[tauri::command]
pub(crate) fn get_download_status(
    state: tauri::State<'_, DesktopState>,
) -> Result<DownloadStatus, ApiError> {
    state.downloads.status().map_err(error)
}

#[tauri::command]
pub(crate) async fn refresh_download_catalog(
    state: tauri::State<'_, DesktopState>,
) -> Result<DownloadStatus, ApiError> {
    let downloads = Arc::clone(&state.downloads);
    crate::generation::blocking(move || downloads.refresh_catalog().map_err(error)).await
}

#[tauri::command]
pub(crate) fn install_download(
    state: tauri::State<'_, DesktopState>,
    resource_id: String,
    components: Vec<String>,
) -> Result<(), ApiError> {
    let resources = Arc::clone(&state.downloads);
    resources
        .begin_install(&resource_id, &components)
        .map_err(error)?;
    tauri::async_runtime::spawn(async move {
        let worker = Arc::clone(&resources);
        let worker_id = resource_id.clone();
        if let Err(error) =
            tauri::async_runtime::spawn_blocking(move || worker.install_prepared(&worker_id)).await
        {
            tracing::error!(resource=resource_id,error=?error,"resource installation worker failed");
            resources.worker_failed(&resource_id, error.to_string());
        }
    });
    Ok(())
}

#[tauri::command]
pub(crate) fn cancel_download(
    state: tauri::State<'_, DesktopState>,
    resource_id: String,
) -> Result<(), ApiError> {
    state.downloads.cancel(&resource_id).map_err(error)
}

#[tauri::command]
pub(crate) async fn uninstall_download(
    state: tauri::State<'_, DesktopState>,
    resource_id: String,
) -> Result<DownloadStatus, ApiError> {
    let downloads = Arc::clone(&state.downloads);
    crate::generation::blocking(move || downloads.uninstall(&resource_id).map_err(error)).await
}

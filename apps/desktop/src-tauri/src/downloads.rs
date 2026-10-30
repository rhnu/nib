//! Resource IPC adapts frontend arguments to application-managed installation tasks.

#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri owns command arguments and Result::map_err consumes errors"
)]

use nib_app::{
    api::{ApiError, ErrorCode, UserMessage},
    downloads::{DownloadStatus, ResourceError},
};

use crate::state::DesktopState;

fn error(error: ResourceError) -> ApiError {
    let code = match &error {
        ResourceError::Invalid(_) => ErrorCode::Invalid,
        ResourceError::NotFound(_) => ErrorCode::NotFound,
        ResourceError::Conflict(_) => ErrorCode::Conflict,
        ResourceError::Failure(_) => {
            tracing::error!(detail = %nib_app::api::error_detail(&error), "resource operation failed");
            ErrorCode::Unavailable
        },
    };
    ApiError {
        code,
        message: UserMessage::external(nib_app::api::error_detail(&error)),
        validation_fields: Vec::new(),
    }
}

#[tauri::command]
pub(crate) fn get_download_status(
    state: tauri::State<'_, DesktopState>,
) -> Result<DownloadStatus, ApiError> {
    state.app.downloads().status().map_err(error)
}

#[tauri::command]
pub(crate) async fn refresh_download_catalog(
    state: tauri::State<'_, DesktopState>,
) -> Result<DownloadStatus, ApiError> {
    state.app.downloads().refresh_catalog().await.map_err(error)
}

#[tauri::command]
pub(crate) fn install_download(
    state: tauri::State<'_, DesktopState>,
    resource_id: String,
    components: Vec<String>,
) -> Result<(), ApiError> {
    state
        .app
        .downloads()
        .install(resource_id, &components)
        .map_err(error)
}

#[tauri::command]
pub(crate) fn cancel_download(
    state: tauri::State<'_, DesktopState>,
    resource_id: String,
) -> Result<(), ApiError> {
    state.app.downloads().cancel(&resource_id).map_err(error)
}

#[tauri::command]
pub(crate) async fn uninstall_download(
    state: tauri::State<'_, DesktopState>,
    resource_id: String,
) -> Result<DownloadStatus, ApiError> {
    state
        .app
        .downloads()
        .uninstall(resource_id)
        .await
        .map_err(error)
}

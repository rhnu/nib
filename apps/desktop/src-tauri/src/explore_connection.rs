//! Optional Danbooru authentication never enters frontend retained state.

use nib_app::{
    api::{ApiError, ErrorCode, UserMessage},
    settings::{DanbooruConnectionError, DanbooruConnectionStatus},
};

use crate::state::DesktopState;

#[tauri::command]
pub(crate) async fn get_danbooru_connection(
    state: tauri::State<'_, DesktopState>,
) -> Result<DanbooruConnectionStatus, ApiError> {
    let app = state.app.clone();
    crate::generation::blocking(move || app.danbooru().status().map_err(connection_error)).await
}

#[tauri::command]
pub(crate) async fn save_danbooru_connection(
    state: tauri::State<'_, DesktopState>,
    username: String,
    api_key: String,
) -> Result<DanbooruConnectionStatus, ApiError> {
    state
        .app
        .danbooru()
        .save(&username, &api_key)
        .await
        .map_err(connection_error)
}

#[tauri::command]
pub(crate) async fn verify_danbooru_connection(
    state: tauri::State<'_, DesktopState>,
) -> Result<DanbooruConnectionStatus, ApiError> {
    state
        .app
        .danbooru()
        .verify()
        .await
        .map_err(connection_error)
}

#[tauri::command]
pub(crate) async fn disconnect_danbooru_connection(
    state: tauri::State<'_, DesktopState>,
) -> Result<DanbooruConnectionStatus, ApiError> {
    state
        .app
        .danbooru()
        .disconnect()
        .await
        .map_err(connection_error)
}

fn connection_error(error: DanbooruConnectionError) -> ApiError {
    let code = match &error {
        DanbooruConnectionError::InvalidInput
        | DanbooruConnectionError::ProfileMismatch
        | DanbooruConnectionError::Rejected => ErrorCode::Invalid,
        DanbooruConnectionError::Conflict => ErrorCode::Conflict,
        _ => ErrorCode::Unavailable,
    };
    let message = match error {
        DanbooruConnectionError::Persistence(error) => {
            return crate::commands::persistence_error(error);
        },
        DanbooruConnectionError::Credential(_) => UserMessage::CredentialUnavailable,
        DanbooruConnectionError::Transport(_) => UserMessage::ProviderTransportFailure,
        DanbooruConnectionError::Http { status } => UserMessage::ProviderHttpFailure { status },
        error => UserMessage::external(error.to_string()),
    };
    ApiError {
        code,
        message,
        validation_fields: Vec::new(),
    }
}

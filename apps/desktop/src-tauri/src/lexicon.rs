//! Vocabulary IPC uses native resources independently of creative data relocation and credentials.

#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects owned State arguments and Result::map_err consumes errors"
)]

use nib_app::{
    api::{ApiError, ErrorCode, UserMessage},
    lexicon::{LexiconError, LexiconQuery, LexiconSearch as _, LexiconSearchResult, LexiconStatus},
};

use crate::state::DesktopState;

fn lexicon_error(error: LexiconError) -> ApiError {
    let code = if matches!(error, LexiconError::Invalid(_)) {
        ErrorCode::Invalid
    } else {
        ErrorCode::Unavailable
    };
    tracing::warn!(error=?error,"vocabulary operation failed");
    ApiError {
        code,
        message: UserMessage::External {
            detail: nib_app::api::error_detail(&error),
        },
        validation_fields: Vec::new(),
    }
}

#[tauri::command]
pub(crate) async fn search_lexicon(
    state: tauri::State<'_, DesktopState>,
    query: LexiconQuery,
) -> Result<LexiconSearchResult, ApiError> {
    let resources = std::sync::Arc::clone(&state.lexicon);
    crate::generation::blocking(move || resources.search(query).map_err(lexicon_error)).await
}

#[tauri::command]
pub(crate) fn get_lexicon_status(
    state: tauri::State<'_, DesktopState>,
) -> Result<LexiconStatus, ApiError> {
    state.lexicon.status().map_err(lexicon_error)
}

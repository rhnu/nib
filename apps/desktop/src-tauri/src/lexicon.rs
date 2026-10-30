//! Vocabulary IPC uses native resources independently of creative data relocation and credentials.

#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects owned State arguments and Result::map_err consumes errors"
)]

use nib_app::{
    api::{ApiError, ErrorCode, UserMessage},
    lexicon::{LexiconError, LexiconQuery, LexiconSearchResult, LexiconStatus},
};

use crate::state::DesktopState;

fn lexicon_error(error: LexiconError) -> ApiError {
    let code = if matches!(error, LexiconError::Invalid(_)) {
        ErrorCode::Invalid
    } else {
        ErrorCode::Unavailable
    };
    if !matches!(error, LexiconError::Invalid(_)) {
        tracing::warn!(detail = %nib_app::api::error_detail(&error), "vocabulary operation failed");
    }
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
    let app = state.app.clone();
    crate::generation::blocking(move || app.lexicon().search(query).map_err(lexicon_error)).await
}

#[tauri::command]
pub(crate) fn get_lexicon_status(
    state: tauri::State<'_, DesktopState>,
) -> Result<LexiconStatus, ApiError> {
    state.app.lexicon().status().map_err(lexicon_error)
}

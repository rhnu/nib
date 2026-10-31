//! Desktop adapters for application-owned Agent connections and runs.

use nib_app::{
    agent::{AgentConnectionConfig, AgentConnectionStatus, AgentError, AgentSnapshot},
    api::{ApiError, ErrorCode, UserMessage},
};

use crate::{commands::persistence_error, generation::blocking, state::DesktopState};

#[expect(
    clippy::needless_pass_by_value,
    reason = "IPC adapters consume domain errors through Result::map_err"
)]
fn agent_error(error: AgentError) -> ApiError {
    ApiError {
        code: if error.is_conflict() {
            ErrorCode::Conflict
        } else if matches!(&error, AgentError::Invalid(_) | AgentError::Unconfigured) {
            ErrorCode::Invalid
        } else {
            ErrorCode::Unavailable
        },
        message: UserMessage::external(error.safe_message()),
        validation_fields: Vec::new(),
    }
}

#[tauri::command]
pub(crate) async fn get_agent_connection(
    state: tauri::State<'_, DesktopState>,
) -> Result<AgentConnectionStatus, ApiError> {
    let access = state.app.read_access().await;
    let app = state.app.clone();
    blocking(move || {
        let _access = access;
        app.agent()
            .map_err(persistence_error)?
            .connection()
            .map_err(agent_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_agent_connection(
    state: tauri::State<'_, DesktopState>,
    config: AgentConnectionConfig,
    api_key: Option<String>,
) -> Result<AgentConnectionStatus, ApiError> {
    let access = state.app.read_access().await;
    let app = state.app.clone();
    blocking(move || {
        let _access = access;
        app.agent()
            .map_err(persistence_error)?
            .save_connection(config, api_key)
            .map_err(agent_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_agent_state(
    state: tauri::State<'_, DesktopState>,
) -> Result<AgentSnapshot, ApiError> {
    let access = state.app.read_access().await;
    let app = state.app.clone();
    blocking(move || {
        let _access = access;
        app.agent()
            .map_err(persistence_error)?
            .snapshot()
            .map_err(agent_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn start_agent_run(
    state: tauri::State<'_, DesktopState>,
    prompt: String,
    expected_epoch: String,
) -> Result<AgentSnapshot, ApiError> {
    let access = state.app.read_access().await;
    let app = state.app.clone();
    let source = app.clone();
    let runtime = blocking(move || {
        let _access = access;
        source.agent().map_err(persistence_error)
    })
    .await?;
    runtime
        .start(app, prompt, expected_epoch)
        .await
        .map_err(agent_error)
}

#[tauri::command]
pub(crate) async fn cancel_agent_run(
    state: tauri::State<'_, DesktopState>,
) -> Result<AgentSnapshot, ApiError> {
    let access = state.app.read_access().await;
    let app = state.app.clone();
    blocking(move || {
        let _access = access;
        app.agent()
            .map_err(persistence_error)?
            .cancel()
            .map_err(agent_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn clear_agent_conversation(
    state: tauri::State<'_, DesktopState>,
) -> Result<AgentSnapshot, ApiError> {
    let access = state.app.write_access().await.map_err(persistence_error)?;
    let app = state.app.clone();
    blocking(move || {
        let _access = access;
        let drafts = app.drafts();
        let _edit = drafts.guard_ui_write().map_err(persistence_error)?;
        app.agent()
            .map_err(persistence_error)?
            .clear()
            .map_err(agent_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn undo_agent_resources(
    state: tauri::State<'_, DesktopState>,
) -> Result<AgentSnapshot, ApiError> {
    let access = state.app.write_access().await.map_err(persistence_error)?;
    let app = state.app.clone();
    blocking(move || {
        let _access = access;
        let drafts = app.drafts();
        let _edit = drafts.guard_ui_write().map_err(persistence_error)?;
        app.agent()
            .map_err(persistence_error)?
            .undo_resources()
            .map_err(agent_error)
    })
    .await
}

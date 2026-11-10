//! Desktop adapters for application-owned Agent connections and runs.

use nib_app::{
    agent::{
        AgentConfiguration, AgentConnectionConfig, AgentConnectionStatus, AgentError,
        AgentPermission, AgentProvider, AgentRuntime, AgentSession, AgentSnapshot, ExtensionError,
        mcp::{McpConnectionTest, McpSecrets, McpServerConfig, McpServerStatus},
        skills::{SkillConfig, SkillDocument, SkillSummary},
    },
    api::{ApiError, ErrorCode, UserMessage},
};

use crate::{commands::persistence_error, generation::blocking, state::DesktopState};

fn agent_error(error: AgentError) -> ApiError {
    match error {
        AgentError::Persistence(error)
        | AgentError::Extension(ExtensionError::Persistence(error)) => {
            return persistence_error(error);
        },
        AgentError::Credentials(ref error)
        | AgentError::Extension(ExtensionError::Credentials(ref error)) => {
            tracing::error!(error = ?error, "Agent system credential operation failed");
        },
        _ => {},
    }
    ApiError {
        code: if error.is_conflict() {
            ErrorCode::Conflict
        } else if matches!(
            &error,
            AgentError::Invalid(_)
                | AgentError::Unconfigured
                | AgentError::Extension(ExtensionError::Invalid(_))
        ) {
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
        app.agent_configuration().connection().map_err(agent_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_agent_connection(
    state: tauri::State<'_, DesktopState>,
    config: AgentConnectionConfig,
    api_key: Option<String>,
) -> Result<AgentConnectionStatus, ApiError> {
    let access = state.app.write_access().await.map_err(persistence_error)?;
    let app = state.app.clone();
    blocking(move || {
        let _access = access;
        app.agent_configuration()
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
    asset_ids: Vec<String>,
    expected_epoch: String,
    expected_session_id: String,
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
        .start(app, prompt, asset_ids, expected_epoch, expected_session_id)
        .await
        .map_err(agent_error)
}

#[tauri::command]
pub(crate) async fn list_agent_models(
    state: tauri::State<'_, DesktopState>,
    provider: AgentProvider,
    api_key: Option<String>,
) -> Result<Vec<String>, ApiError> {
    let app = state.app.clone();
    app.agent_configuration()
        .models(provider, api_key)
        .await
        .map_err(agent_error)
}

#[tauri::command]
pub(crate) async fn save_agent_permission(
    state: tauri::State<'_, DesktopState>,
    permission: AgentPermission,
) -> Result<AgentConnectionStatus, ApiError> {
    let access = state.app.write_access().await.map_err(persistence_error)?;
    let app = state.app.clone();
    blocking(move || {
        let _access = access;
        app.agent_configuration()
            .save_permission(permission)
            .map_err(agent_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn approve_agent_generation(
    state: tauri::State<'_, DesktopState>,
    id: String,
    allow: bool,
) -> Result<AgentSnapshot, ApiError> {
    let app = state.app.clone();
    blocking(move || {
        app.agent()
            .map_err(persistence_error)?
            .approve(&id, allow)
            .map_err(agent_error)
    })
    .await
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

#[tauri::command]
pub(crate) async fn list_agent_sessions(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<AgentSession>, ApiError> {
    let access = state.app.read_access().await;
    let app = state.app.clone();
    blocking(move || {
        let _access = access;
        app.agent()
            .map_err(persistence_error)?
            .sessions()
            .map_err(agent_error)
    })
    .await
}

async fn change_session(
    desktop: DesktopState,
    change: impl FnOnce(&AgentRuntime) -> Result<AgentSnapshot, AgentError> + Send + 'static,
) -> Result<AgentSnapshot, ApiError> {
    let access = desktop
        .app
        .write_access()
        .await
        .map_err(persistence_error)?;
    blocking(move || {
        let _access = access;
        let drafts = desktop.app.drafts();
        let mut edit = drafts.guard_ui_write().map_err(persistence_error)?;
        let runtime = desktop.app.agent().map_err(persistence_error)?;
        let previous = runtime.snapshot().map_err(agent_error)?.session_id;
        let next = change(&runtime).map_err(agent_error)?;
        if previous != next.session_id {
            edit.discard_agent_undo();
        }
        Ok(next)
    })
    .await
}

#[tauri::command]
pub(crate) async fn new_agent_session(
    state: tauri::State<'_, DesktopState>,
) -> Result<AgentSnapshot, ApiError> {
    change_session(state.inner().clone(), AgentRuntime::new_session).await
}

#[tauri::command]
pub(crate) async fn select_agent_session(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<AgentSnapshot, ApiError> {
    change_session(state.inner().clone(), move |runtime| {
        runtime.select_session(&id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_agent_session(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<AgentSnapshot, ApiError> {
    change_session(state.inner().clone(), move |runtime| {
        runtime.delete_session(&id)
    })
    .await
}

async fn configuration_read<T: Send + 'static>(
    desktop: DesktopState,
    read: impl FnOnce(&AgentConfiguration) -> Result<T, ExtensionError> + Send + 'static,
) -> Result<T, ApiError> {
    let configuration = std::sync::Arc::clone(desktop.app.agent_configuration());
    blocking(move || read(&configuration).map_err(|error| agent_error(error.into()))).await
}

async fn configuration_write<T: Send + 'static>(
    desktop: DesktopState,
    write: impl FnOnce(&AgentConfiguration) -> Result<T, ExtensionError> + Send + 'static,
) -> Result<T, ApiError> {
    let access = desktop
        .app
        .write_access()
        .await
        .map_err(persistence_error)?;
    let configuration = std::sync::Arc::clone(desktop.app.agent_configuration());
    blocking(move || {
        let _access = access;
        write(&configuration).map_err(|error| agent_error(error.into()))
    })
    .await
}

#[tauri::command]
pub(crate) async fn agent_mcp_servers(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<McpServerStatus>, ApiError> {
    configuration_read(state.inner().clone(), AgentConfiguration::mcp_servers).await
}

#[tauri::command]
pub(crate) async fn agent_save_mcp_server(
    state: tauri::State<'_, DesktopState>,
    config: McpServerConfig,
    secrets: Option<McpSecrets>,
) -> Result<Vec<McpServerStatus>, ApiError> {
    configuration_write(state.inner().clone(), move |configuration| {
        configuration.save_mcp_server(config, secrets)
    })
    .await
}

#[tauri::command]
pub(crate) async fn agent_remove_mcp_server(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<Vec<McpServerStatus>, ApiError> {
    configuration_write(state.inner().clone(), move |configuration| {
        configuration.remove_mcp_server(&id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn agent_test_mcp_server(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<McpConnectionTest, ApiError> {
    let access = state.app.read_access().await;
    let result = state.app.agent_configuration().test_mcp_server(&id).await;
    drop(access);
    result.map_err(|error| agent_error(error.into()))
}

#[tauri::command]
pub(crate) async fn agent_skills(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<SkillConfig>, ApiError> {
    configuration_read(state.inner().clone(), AgentConfiguration::skills).await
}

#[tauri::command]
pub(crate) async fn agent_save_skill(
    state: tauri::State<'_, DesktopState>,
    config: SkillConfig,
) -> Result<Vec<SkillConfig>, ApiError> {
    configuration_write(state.inner().clone(), move |configuration| {
        configuration.save_skill(config)
    })
    .await
}

#[tauri::command]
pub(crate) async fn agent_remove_skill(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<Vec<SkillConfig>, ApiError> {
    configuration_write(state.inner().clone(), move |configuration| {
        configuration.remove_skill(&id)
    })
    .await
}

#[tauri::command]
pub(crate) async fn agent_skill_catalog(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<SkillSummary>, ApiError> {
    configuration_read(state.inner().clone(), AgentConfiguration::skill_catalog).await
}

#[tauri::command]
pub(crate) async fn agent_read_skill(
    state: tauri::State<'_, DesktopState>,
    id: String,
    path: Option<String>,
) -> Result<SkillDocument, ApiError> {
    configuration_read(state.inner().clone(), move |configuration| {
        configuration.read_skill(&id, path.as_deref())
    })
    .await
}

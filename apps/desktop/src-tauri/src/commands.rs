//! IPC adaptation and blocking database work. Domain behavior stays in nib-app.

use nib_app::{
    api::{ApiError, ErrorCode, WorkspaceSnapshot},
    jobs::SdkClientProvider as _,
    library::{ResourceQuery, ResourceSearch as _, ResourceSummary},
    persistence::{PersistenceError, SqliteDatabase},
    prompt::{
        self, ExpansionError, PresetInstance, PromptNode, ResolvedDraft, Resource,
        ResourceReader as _, ResourceWriter as _,
    },
    session::{Draft, DraftStore as _},
};

use crate::state::DesktopState;

pub(crate) fn persistence_error(error: PersistenceError) -> ApiError {
    let (code, message) = match error {
        PersistenceError::NotFound { .. } => (ErrorCode::NotFound, "内容已不存在，请刷新后重试。"),
        PersistenceError::Conflict { .. } => (
            ErrorCode::Conflict,
            "内容已被修改。当前编辑仍保留，请重新加载后处理冲突。",
        ),
        PersistenceError::InvalidData { message } => {
            return ApiError {
                code: ErrorCode::Invalid,
                message,
            };
        },
        PersistenceError::UnsupportedSchema { .. } => (
            ErrorCode::Unavailable,
            "本地数据库结构与当前版本不兼容，请移走旧 nib.sqlite3 后重新打开。",
        ),
        _ => (
            ErrorCode::Unavailable,
            "无法读写本地数据。当前编辑仍保留，请重试。",
        ),
    };
    if matches!(code, ErrorCode::Unavailable) {
        tracing::error!(error = ?error, "local data operation failed");
    }
    ApiError {
        code,
        message: message.to_owned(),
    }
}

fn expansion_error(error: ExpansionError) -> ApiError {
    match error {
        ExpansionError::Persistence(error) => persistence_error(error),
        ExpansionError::Unresolved { issues } => ApiError {
            code: ErrorCode::Unresolved,
            message: issues
                .into_iter()
                .map(|issue| issue.message)
                .collect::<Vec<_>>()
                .join("\n"),
        },
    }
}

async fn with_database<T: Send + 'static>(
    state: tauri::State<'_, DesktopState>,
    action: impl FnOnce(&SqliteDatabase) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let database = state.database().map_err(persistence_error)?;
        action(&database)
    })
    .await
    .map_err(|error| {
        tracing::error!(error = ?error, "database worker failed");
        ApiError {
            code: ErrorCode::Unavailable,
            message: "本地数据操作未完成，请重试。".to_owned(),
        }
    })?
}

#[tauri::command]
pub(crate) async fn inspect_tokens(
    state: tauri::State<'_, DesktopState>,
    model: novelai_bridge::Model,
    text: String,
    framing: novelai_bridge::FramingPolicy,
) -> Result<prompt::TokenInspection, ApiError> {
    let desktop = state.inner().clone();
    crate::generation::blocking(move || {
        let sdk = desktop.sdk().map_err(crate::generation::generation_error)?;
        prompt::inspect_tokens(&sdk.tokenizers(), model, &text, framing)
            .map_err(novelai_bridge::BridgeError::from)
            .map_err(nib_app::jobs::JobError::from)
            .map_err(crate::generation::generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_workspace(
    state: tauri::State<'_, DesktopState>,
) -> Result<WorkspaceSnapshot, ApiError> {
    with_database(state, |database| {
        let draft = database.get_draft().map_err(persistence_error)?;
        Ok(WorkspaceSnapshot {
            info: nib_app::app_info(),
            resources: database
                .search_resources(&ResourceQuery::default())
                .map_err(persistence_error)?,
            draft,
            models: novelai_bridge::Model::ALL
                .into_iter()
                .map(|model| model.as_str().to_owned())
                .collect(),
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn search_resources(
    state: tauri::State<'_, DesktopState>,
    query: ResourceQuery,
) -> Result<Vec<ResourceSummary>, ApiError> {
    with_database(state, move |database| {
        database.search_resources(&query).map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_resource(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<Resource, ApiError> {
    with_database(state, move |database| {
        database
            .get_resource(&id)
            .map_err(persistence_error)?
            .ok_or_else(|| {
                persistence_error(PersistenceError::NotFound {
                    kind: "resource",
                    id,
                })
            })
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_resource(
    state: tauri::State<'_, DesktopState>,
    resource: Resource,
) -> Result<Resource, ApiError> {
    with_database(state, move |database| {
        database.save_resource(&resource).map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_resource(
    state: tauri::State<'_, DesktopState>,
    id: String,
    revision: u32,
) -> Result<(), ApiError> {
    with_database(state, move |database| {
        database
            .delete_resource(&id, revision)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_draft(
    state: tauri::State<'_, DesktopState>,
    draft: Draft,
) -> Result<Draft, ApiError> {
    with_database(state, move |database| {
        database.save_draft(&draft).map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn resolve_draft(
    state: tauri::State<'_, DesktopState>,
    draft: Draft,
) -> Result<ResolvedDraft, ApiError> {
    with_database(state, move |database| {
        nib_app::session::validate_draft(&draft).map_err(|error| ApiError {
            code: ErrorCode::Invalid,
            message: error.to_string(),
        })?;
        database
            .read_resources(|reader| prompt::resolve_draft(&draft, reader))
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_model_capabilities(
    state: tauri::State<'_, DesktopState>,
    draft: Draft,
) -> Result<Option<nib_app::api::ModelCapabilities>, ApiError> {
    with_database(state, move |database| {
        let resolved = database
            .read_resources(|reader| prompt::resolve_draft(&draft, reader))
            .map_err(persistence_error)?;
        Ok(nib_app::api::model_capabilities(&resolved))
    })
    .await
}

#[tauri::command]
pub(crate) async fn expand_chunk(
    state: tauri::State<'_, DesktopState>,
    node: PromptNode,
) -> Result<PromptNode, ApiError> {
    with_database(state, move |database| {
        database
            .read_resources(|reader| prompt::expand_chunk(&node, reader))
            .map_err(expansion_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn expand_preset(
    state: tauri::State<'_, DesktopState>,
    instance: PresetInstance,
) -> Result<PresetInstance, ApiError> {
    with_database(state, move |database| {
        database
            .read_resources(|reader| prompt::expand_preset(&instance, reader))
            .map_err(expansion_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn suggest_tags(
    state: tauri::State<'_, DesktopState>,
    request: novelai_bridge::SuggestTagsRequest,
) -> Result<novelai_bridge::SuggestTagsResult, ApiError> {
    let desktop = state.inner().clone();
    let client = crate::generation::blocking(move || {
        desktop
            .sdk()
            .and_then(|clients| clients.client())
            .map_err(crate::generation::generation_error)
    })
    .await?;
    prompt::TagQuery::suggest_tags(&client, request)
        .await
        .map_err(|error| crate::generation::generation_error(error.into()))
}

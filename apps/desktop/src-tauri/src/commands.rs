//! IPC adaptation and blocking database work. Domain behavior stays in nib-app.

use nib_app::{
    api::{ApiError, DraftAnalysis, ErrorCode, UserMessage, WorkspaceSnapshot},
    library::{
        ResourceBatchAction, ResourceFolder, ResourceImpact, ResourcePage, ResourceQuery,
        ResourceSearch as _, ResourceSelection, ResourceVersion,
    },
    persistence::{PersistenceError, SqliteDatabase},
    prompt::{self, ExpansionError, PresetInstance, PromptNode, Resource, ResourceReader as _},
    session::{Draft, DraftStore as _},
};

use crate::state::DesktopState;

#[expect(
    clippy::needless_pass_by_value,
    reason = "IPC adapters consume repository errors through Result::map_err"
)]
pub(crate) fn persistence_error(error: PersistenceError) -> ApiError {
    let code = match &error {
        PersistenceError::NotFound { .. } => ErrorCode::NotFound,
        PersistenceError::Conflict { .. } => ErrorCode::Conflict,
        PersistenceError::InvalidData { .. } => ErrorCode::Invalid,
        _ => ErrorCode::Unavailable,
    };
    if matches!(code, ErrorCode::Unavailable) {
        tracing::error!(error = ?error, "local data operation failed");
    }
    let message = error.user_message();
    let validation_fields = match &message {
        UserMessage::Validation { field, .. } => vec![field.clone()],
        _ => Vec::new(),
    };
    ApiError {
        validation_fields,
        code,
        message,
    }
}

fn expansion_error(error: ExpansionError) -> ApiError {
    match error {
        ExpansionError::Persistence(error) => persistence_error(error),
        ExpansionError::Unresolved { issues } => ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unresolved,
            message: UserMessage::Messages {
                messages: issues.into_iter().map(|issue| issue.message).collect(),
            },
        },
    }
}

async fn with_database<T: Send + 'static>(
    state: tauri::State<'_, DesktopState>,
    action: impl FnOnce(&SqliteDatabase) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let access = state.app.read_access().await;
    run_database(state.inner().clone(), access, action).await
}

async fn with_database_write<T: Send + 'static>(
    state: tauri::State<'_, DesktopState>,
    action: impl FnOnce(&SqliteDatabase) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let access = state.app.write_access().await.map_err(persistence_error)?;
    run_database(state.inner().clone(), access, action).await
}

async fn run_database<T: Send + 'static>(
    state: DesktopState,
    access: tokio::sync::OwnedRwLockReadGuard<()>,
    action: impl FnOnce(&SqliteDatabase) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    crate::generation::blocking(move || {
        let _access = access;
        let database = state.app.database().map_err(persistence_error)?;
        action(&database)
    })
    .await
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
        let sdk = desktop
            .app
            .sdk()
            .map_err(crate::generation::generation_error)?;
        prompt::inspect_tokens(&sdk.tokenizers(), model, &text, framing)
            .map_err(novelai_bridge::BridgeError::from)
            .map_err(nib_app::jobs::JobError::from)
            .map_err(crate::generation::generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) fn get_prompt_syntax(
    model: Option<novelai_bridge::Model>,
) -> novelai_bridge::PromptSyntaxProfile {
    model.map_or_else(novelai_bridge::PromptSyntaxProfile::default, |model| {
        model.descriptor().prompt().syntax
    })
}

#[tauri::command]
pub(crate) fn get_model_defaults_capabilities(
    model: Option<novelai_bridge::Model>,
    settings: Option<prompt::GenerationSettings>,
) -> nib_app::api::ModelCapabilities {
    nib_app::api::model_defaults_capabilities(model.unwrap_or_default(), settings)
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
                .read_resources(|reader| {
                    nib_app::library::resource_definitions(
                        &nib_app::library::draft_resource_ids(&draft),
                        reader,
                    )
                })
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
pub(crate) async fn get_resource_definitions(
    state: tauri::State<'_, DesktopState>,
    ids: Vec<String>,
) -> Result<Vec<Resource>, ApiError> {
    with_database(state, move |database| {
        database
            .read_resources(|reader| nib_app::library::resource_definitions(&ids, reader))
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn search_resources(
    state: tauri::State<'_, DesktopState>,
    query: ResourceQuery,
) -> Result<ResourcePage, ApiError> {
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
    crate::media::with_media_write(state, move |media| {
        media
            .save_resource_with_cover(&resource)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_resource(
    state: tauri::State<'_, DesktopState>,
    id: String,
    revision: u32,
) -> Result<(), ApiError> {
    crate::media::with_media_write(state, move |media| {
        media
            .batch_resources(
                &ResourceSelection {
                    resources: vec![ResourceVersion { id, revision }],
                    folders: Vec::new(),
                },
                &ResourceBatchAction::Delete,
            )
            .map(|_| ())
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_draft(
    state: tauri::State<'_, DesktopState>,
    draft: Draft,
) -> Result<(), ApiError> {
    with_database_write(state, move |database| {
        database.save_draft(&draft).map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn resolve_draft(
    state: tauri::State<'_, DesktopState>,
    draft: Draft,
    include_quote: bool,
) -> Result<DraftAnalysis, ApiError> {
    let desktop = state.inner().clone();
    with_database(state, move |database| {
        nib_app::session::validate_draft(&draft).map_err(|error| ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Invalid,
            message: UserMessage::Validation {
                field: error.field.clone(),
                message: Box::new(error.message),
            },
        })?;
        let resolved = database
            .read_resources(|reader| prompt::resolve_draft(&draft, reader))
            .map_err(persistence_error)?;
        let (quote, quote_error) = if include_quote {
            match desktop.generation().and_then(|runtime| {
                if matches!(
                    &draft.inputs.operation,
                    nib_app::session::CreationOperation::TextToImage
                        | nib_app::session::CreationOperation::ImageToImage { .. }
                        | nib_app::session::CreationOperation::Inpainting { .. }
                ) {
                    runtime.quote_resolved(resolved.clone())
                } else {
                    runtime.quote(&draft)
                }
            }) {
                Ok(quote) => (Some(quote), None),
                Err(error) => (None, Some(crate::generation::generation_error(error))),
            }
        } else {
            (None, None)
        };
        Ok(DraftAnalysis {
            capabilities: nib_app::api::model_capabilities(&resolved),
            resolved,
            quote,
            quote_error,
        })
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
pub(crate) async fn list_resource_folders(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<ResourceFolder>, ApiError> {
    with_database(state, |database| {
        database.list_resource_folders().map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_resource_folder(
    state: tauri::State<'_, DesktopState>,
    folder: ResourceFolder,
) -> Result<ResourceFolder, ApiError> {
    with_database_write(state, move |database| {
        database
            .save_resource_folder(&folder)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_resource_tags(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<String>, ApiError> {
    with_database(state, |database| {
        database.list_resource_tags().map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn resource_selection_impact(
    state: tauri::State<'_, DesktopState>,
    selection: ResourceSelection,
) -> Result<ResourceImpact, ApiError> {
    with_database(state, move |database| {
        database
            .resource_selection_impact(&selection)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn batch_resources(
    state: tauri::State<'_, DesktopState>,
    selection: ResourceSelection,
    action: ResourceBatchAction,
) -> Result<ResourceImpact, ApiError> {
    crate::media::with_media_write(state, move |media| {
        media
            .batch_resources(&selection, &action)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn rename_resource_tag(
    state: tauri::State<'_, DesktopState>,
    old_name: String,
    new_name: String,
) -> Result<Vec<nib_app::library::ResourceSummary>, ApiError> {
    with_database_write(state, move |database| {
        database
            .rename_resource_tag(&old_name, &new_name)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_resource_tag(
    state: tauri::State<'_, DesktopState>,
    name: String,
) -> Result<Vec<nib_app::library::ResourceSummary>, ApiError> {
    with_database_write(state, move |database| {
        database
            .delete_resource_tag(&name)
            .map_err(persistence_error)
    })
    .await
}

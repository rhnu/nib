//! IPC adapters for credentials, frozen submissions, and retained final images.

use std::sync::Arc;

use nib_app::{
    api::{ApiError, ErrorCode, UserMessage},
    jobs::{GenerationBatch, GenerationQuote, JobError, JobPage, JobQuery, JobQueue, JobRecord},
    session::Draft,
    settings::{AccountError, AccountStatus, CredentialError},
};

use crate::state::DesktopState;

fn credential_error(error: &CredentialError) -> ApiError {
    // Keyring errors can contain rejected secret bytes; never render their Debug or Display.
    ApiError {
        validation_fields: Vec::new(),
        code: if matches!(error, CredentialError::InvalidKey) {
            ErrorCode::Invalid
        } else {
            ErrorCode::Unavailable
        },
        message: if matches!(error, CredentialError::InvalidKey) {
            UserMessage::InvalidApiKey
        } else {
            UserMessage::CredentialUnavailable
        },
    }
}

pub(crate) fn generation_error(error: JobError) -> ApiError {
    match error {
        JobError::Persistence(error) => crate::commands::persistence_error(error),
        JobError::Credential(error) => credential_error(&error),
        JobError::MissingCredentials => ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unavailable,
            message: UserMessage::MissingCredentials,
        },
        JobError::Unresolved => ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unresolved,
            message: UserMessage::UnresolvedResources,
        },
        JobError::Unavailable => ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unavailable,
            message: UserMessage::QueueUnavailable,
        },
        JobError::Worker(_) => ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unavailable,
            message: UserMessage::WorkerInterrupted,
        },
        error @ JobError::Bridge(
            novelai_bridge::BridgeError::Api(_) | novelai_bridge::BridgeError::Transport(_),
        ) => ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unavailable,
            message: error.user_message(),
        },
        JobError::Bridge(novelai_bridge::BridgeError::InvalidRequest(error)) => ApiError {
            validation_fields: nib_app::api::request_error_fields(&error),
            code: ErrorCode::Invalid,
            message: UserMessage::external(nib_app::api::error_detail(&error)),
        },
        error => {
            let message = error.user_message();
            let validation_fields = match &message {
                UserMessage::Validation { field, .. } => vec![field.clone()],
                _ => Vec::new(),
            };
            ApiError {
                validation_fields,
                code: ErrorCode::Invalid,
                message,
            }
        },
    }
}

pub(crate) async fn blocking<T: Send + 'static>(
    action: impl FnOnce() -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|_worker_error| ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unavailable,
            message: UserMessage::OperationIncomplete,
        })?
}

pub(crate) async fn with_generation<T: Send + 'static>(
    state: tauri::State<'_, DesktopState>,
    action: impl FnOnce(Arc<JobQueue>) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let state = state.inner().clone();
    let guard = state.app.read_access().await;
    blocking(move || {
        let _guard = guard;
        let runtime = state.app.generation().map_err(generation_error)?;
        action(runtime)
    })
    .await
}

async fn with_generation_write<T: Send + 'static>(
    state: tauri::State<'_, DesktopState>,
    action: impl FnOnce(Arc<JobQueue>) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let state = state.inner().clone();
    let guard = state
        .app
        .write_access()
        .await
        .map_err(crate::commands::persistence_error)?;
    blocking(move || {
        let _guard = guard;
        let runtime = state.app.generation().map_err(generation_error)?;
        action(runtime)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_account_status(
    state: tauri::State<'_, DesktopState>,
) -> Result<AccountStatus, ApiError> {
    let desktop = state.inner().clone();
    blocking(move || {
        desktop
            .app
            .settings()
            .credentials()
            .map_err(crate::commands::persistence_error)
    })
    .await
}

fn account_error(error: AccountError) -> ApiError {
    match error {
        AccountError::Persistence(error) => crate::commands::persistence_error(error),
        AccountError::Credential(error) => credential_error(&error),
        AccountError::Invalid(message) => ApiError {
            code: ErrorCode::Invalid,
            message,
            validation_fields: Vec::new(),
        },
        AccountError::PendingJobs => ApiError {
            code: ErrorCode::Conflict,
            message: UserMessage::AccountHasPendingJobs,
            validation_fields: Vec::new(),
        },
    }
}

#[tauri::command]
pub(crate) async fn save_account_key(
    state: tauri::State<'_, DesktopState>,
    id: Option<String>,
    name: String,
    key: Option<String>,
) -> Result<AccountStatus, ApiError> {
    let access = state
        .app
        .credential_change_access()
        .await
        .map_err(crate::commands::persistence_error)?;
    let desktop = state.inner().clone();
    blocking(move || {
        let _access = access;
        let status = nib_app::settings::save_account(
            desktop.app.settings(),
            desktop.app.credentials(),
            id,
            &name,
            key.as_deref(),
        )
        .map_err(account_error)?;
        desktop.app.invalidate_sdk().map_err(generation_error)?;
        Ok(status)
    })
    .await
}

#[tauri::command]
pub(crate) async fn activate_account(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<AccountStatus, ApiError> {
    let access = state
        .app
        .credential_change_access()
        .await
        .map_err(crate::commands::persistence_error)?;
    let desktop = state.inner().clone();
    blocking(move || {
        let _access = access;
        let status = nib_app::settings::activate_account(desktop.app.settings(), &id)
            .map_err(account_error)?;
        desktop.app.invalidate_sdk().map_err(generation_error)?;
        Ok(status)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_account_key(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<AccountStatus, ApiError> {
    let access = state
        .app
        .credential_change_access()
        .await
        .map_err(crate::commands::persistence_error)?;
    let desktop = state.inner().clone();
    blocking(move || {
        let _access = access;
        let database = desktop
            .app
            .database()
            .map_err(crate::commands::persistence_error)?;
        let status = nib_app::settings::delete_account(
            desktop.app.settings(),
            desktop.app.credentials(),
            database.as_ref(),
            &id,
        )
        .map_err(account_error)?;
        desktop.app.invalidate_sdk().map_err(generation_error)?;
        Ok(status)
    })
    .await
}

#[tauri::command]
pub(crate) async fn quote_generation(
    state: tauri::State<'_, DesktopState>,
    draft: Draft,
) -> Result<GenerationQuote, ApiError> {
    with_generation(state, move |runtime| {
        runtime.quote(&draft).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn submit_generation(
    state: tauri::State<'_, DesktopState>,
    draft: Draft,
) -> Result<GenerationBatch, ApiError> {
    with_generation_write(state, move |runtime| {
        runtime.submit(&draft).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn ensure_vibe_encoding(
    state: tauri::State<'_, DesktopState>,
    input: nib_app::session::VibeEncodingInput,
    policy: novelai_bridge::ValidationPolicy,
) -> Result<nib_app::jobs::VibeEncodingOutcome, ApiError> {
    with_generation_write(state, move |runtime| {
        runtime
            .ensure_vibe_encoding(input, policy)
            .map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_jobs(
    state: tauri::State<'_, DesktopState>,
    query: JobQuery,
) -> Result<JobPage, ApiError> {
    with_generation(state, move |runtime| {
        runtime.list(&query).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_job(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<JobRecord, ApiError> {
    with_generation(state, move |runtime| {
        runtime.get(&id).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn cancel_job(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<JobRecord, ApiError> {
    with_generation_write(state, move |runtime| {
        runtime.cancel(&id).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn retry_job(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<JobRecord, ApiError> {
    with_generation_write(state, move |runtime| {
        runtime.retry(&id).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_account_summary(
    state: tauri::State<'_, DesktopState>,
) -> Result<nib_app::settings::AccountSnapshot, ApiError> {
    let desktop = state.inner().clone();
    blocking(move || {
        desktop
            .app
            .sdk()
            .map_err(generation_error)?
            .account()
            .map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn refresh_account_summary(
    state: tauri::State<'_, DesktopState>,
) -> Result<nib_app::settings::AccountSnapshot, ApiError> {
    let sdk = state.app.sdk().map_err(generation_error)?;
    sdk.refresh_account(true).await;
    sdk.account().map_err(generation_error)
}

#[tauri::command]
pub(crate) async fn subscribe_job_feedback(
    state: tauri::State<'_, DesktopState>,
    window: tauri::WebviewWindow,
    subscription_id: String,
    on_event: tauri::ipc::Channel<nib_app::jobs::JobFeedback>,
) -> Result<(), ApiError> {
    let desktop = state.inner().clone();
    desktop
        .begin_feedback(window.label().to_owned(), subscription_id.clone())
        .map_err(crate::commands::persistence_error)?;
    let runtime = match with_generation(state, Ok).await {
        Ok(runtime) => runtime,
        Err(error) => {
            desktop
                .stop_feedback(window.label(), Some(&subscription_id))
                .map_err(crate::commands::persistence_error)?;
            return Err(error);
        },
    };
    let mut feedback = runtime.subscribe();
    let worker = tauri::async_runtime::spawn(async move {
        loop {
            match feedback.recv().await {
                Ok(event) => {
                    if on_event.send(event).is_err() {
                        break;
                    }
                },
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    if on_event
                        .send(nib_app::jobs::JobFeedback::ResyncRequired)
                        .is_err()
                    {
                        break;
                    }
                },
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    desktop
        .attach_feedback(window.label(), &subscription_id, worker)
        .map_err(crate::commands::persistence_error)
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri injects owned command arguments"
)]
pub(crate) fn unsubscribe_job_feedback(
    state: tauri::State<'_, DesktopState>,
    window: tauri::WebviewWindow,
    subscription_id: String,
) -> Result<(), ApiError> {
    state
        .stop_feedback(window.label(), Some(&subscription_id))
        .map_err(crate::commands::persistence_error)
}

//! IPC adapters for credentials, frozen submissions, and retained final images.

use std::sync::Arc;

use nib_app::{
    api::{ApiError, ErrorCode},
    jobs::{GenerationQuote, JobError, JobRecord},
    session::Draft,
    settings::{AccountStatus, CredentialError, CredentialStore as _},
};
use novelai_bridge::SecretString;

use crate::state::{DesktopState, GenerationRuntime};

fn credential_error(error: &CredentialError) -> ApiError {
    // Keyring errors can contain rejected secret bytes; never render their Debug or Display.
    ApiError {
        code: if matches!(error, CredentialError::InvalidKey) {
            ErrorCode::Invalid
        } else {
            ErrorCode::Unavailable
        },
        message: if matches!(error, CredentialError::InvalidKey) {
            "API Key 格式无效，请重新输入。"
        } else {
            "无法访问系统凭据。请重试，或检查 Windows 凭据管理器。"
        }
        .to_owned(),
    }
}

pub(crate) fn generation_error(error: JobError) -> ApiError {
    match error {
        JobError::Persistence(error) => crate::commands::persistence_error(error),
        JobError::Credential(error) => credential_error(&error),
        JobError::MissingCredentials => ApiError {
            code: ErrorCode::Unavailable,
            message: "请先配置 NovelAI API Key。".to_owned(),
        },
        JobError::Unresolved => ApiError {
            code: ErrorCode::Unresolved,
            message: "当前创作有未解决的资源引用，请在解析面板中处理后再生成。".to_owned(),
        },
        JobError::Unavailable => ApiError {
            code: ErrorCode::Unavailable,
            message: "生成队列已停止，请重新打开应用。未完成任务不会自动重新请求。".to_owned(),
        },
        JobError::Worker(_) => ApiError {
            code: ErrorCode::Unavailable,
            message: "后台生成操作中断，请确认任务状态后重试。".to_owned(),
        },
        JobError::Bridge(novelai_bridge::BridgeError::Api(error)) => ApiError {
            code: ErrorCode::Unavailable,
            message: format!("NovelAI 请求失败（HTTP {}）。", error.status()),
        },
        JobError::Bridge(novelai_bridge::BridgeError::Transport(_)) => ApiError {
            code: ErrorCode::Unavailable,
            message: "无法连接 NovelAI。请求可能已被服务端处理，请确认后再重试。".to_owned(),
        },
        error => ApiError {
            code: ErrorCode::Invalid,
            message: error.user_message(),
        },
    }
}

pub(crate) async fn blocking<T: Send + 'static>(
    action: impl FnOnce() -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    tauri::async_runtime::spawn_blocking(action)
        .await
        .map_err(|_worker_error| ApiError {
            code: ErrorCode::Unavailable,
            message: "操作未完成，请重试。".to_owned(),
        })?
}

pub(crate) async fn with_generation<T: Send + 'static>(
    state: tauri::State<'_, DesktopState>,
    action: impl FnOnce(Arc<GenerationRuntime>) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let state = state.inner().clone();
    blocking(move || {
        let runtime = state.generation().map_err(generation_error)?;
        action(runtime)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_account_status(
    state: tauri::State<'_, DesktopState>,
) -> Result<AccountStatus, ApiError> {
    let credentials = Arc::clone(&state.credentials);
    blocking(move || {
        Ok(AccountStatus {
            configured: credentials
                .load()
                .map_err(|error| credential_error(&error))?
                .is_some(),
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_account_key(
    state: tauri::State<'_, DesktopState>,
    key: String,
) -> Result<AccountStatus, ApiError> {
    let desktop = state.inner().clone();
    let credentials = Arc::clone(&desktop.credentials);
    let key = SecretString::from(key);
    blocking(move || {
        use secrecy::ExposeSecret as _;
        let trimmed = key.expose_secret().trim();
        if trimmed.is_empty() {
            return Err(ApiError {
                code: ErrorCode::Invalid,
                message: "请输入 NovelAI API Key。".to_owned(),
            });
        }
        nib_app::settings::validate_api_key(&SecretString::from(trimmed.to_owned()))
            .map_err(|error| credential_error(&error))?;
        credentials
            .save(SecretString::from(trimmed.to_owned()))
            .map_err(|error| credential_error(&error))?;
        desktop.invalidate_sdk().map_err(generation_error)?;
        Ok(AccountStatus { configured: true })
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_account_key(
    state: tauri::State<'_, DesktopState>,
) -> Result<AccountStatus, ApiError> {
    let desktop = state.inner().clone();
    let credentials = Arc::clone(&desktop.credentials);
    blocking(move || {
        credentials
            .delete()
            .map_err(|error| credential_error(&error))?;
        desktop.invalidate_sdk().map_err(generation_error)?;
        Ok(AccountStatus { configured: false })
    })
    .await
}

#[tauri::command]
pub(crate) async fn quote_generation(
    state: tauri::State<'_, DesktopState>,
    draft: Draft,
) -> Result<GenerationQuote, ApiError> {
    with_generation(state, move |runtime| {
        runtime.queue.quote(&draft).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn submit_generation(
    state: tauri::State<'_, DesktopState>,
    draft: Draft,
) -> Result<JobRecord, ApiError> {
    with_generation(state, move |runtime| {
        runtime.queue.submit(&draft).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_jobs(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<JobRecord>, ApiError> {
    with_generation(state, |runtime| {
        runtime.queue.list().map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn cancel_job(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<JobRecord, ApiError> {
    with_generation(state, move |runtime| {
        runtime.queue.cancel(&id).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn retry_job(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<JobRecord, ApiError> {
    with_generation(state, move |runtime| {
        runtime.queue.retry(&id).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_account_summary(
    state: tauri::State<'_, DesktopState>,
) -> Result<Option<nib_app::settings::AccountSummary>, ApiError> {
    with_generation(state, |runtime| Ok(runtime.queue.account())).await
}

#[tauri::command]
pub(crate) async fn refresh_account_summary(
    state: tauri::State<'_, DesktopState>,
) -> Result<nib_app::settings::AccountSummary, ApiError> {
    let desktop = state.inner().clone();
    let runtime = blocking(move || desktop.generation().map_err(generation_error)).await?;
    runtime
        .queue
        .refresh_account()
        .await
        .map_err(generation_error)
}

#[tauri::command]
pub(crate) async fn subscribe_job_feedback(
    state: tauri::State<'_, DesktopState>,
    window: tauri::WebviewWindow,
    on_event: tauri::ipc::Channel<nib_app::jobs::JobFeedback>,
) -> Result<(), ApiError> {
    let desktop = state.inner().clone();
    let runtime = with_generation(state, Ok).await?;
    let mut feedback = runtime.queue.subscribe();
    let worker = tauri::async_runtime::spawn(async move {
        loop {
            match feedback.recv().await {
                Ok(event) => {
                    if on_event.send(event).is_err() {
                        break;
                    }
                },
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {},
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
    desktop
        .replace_feedback(window.label().to_owned(), worker)
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
) -> Result<(), ApiError> {
    state
        .stop_feedback(window.label())
        .map_err(crate::commands::persistence_error)
}

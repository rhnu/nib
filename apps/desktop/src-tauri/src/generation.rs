//! IPC adapters for credentials, frozen submissions, and retained final images.

use std::sync::Arc;

use nib_app::{
    api::{ApiError, ErrorCode},
    jobs::{GenerationBatch, GenerationQuote, JobError, JobPage, JobQuery, JobRecord},
    session::Draft,
    settings::{AccountStatus, CredentialError, CredentialStore as _},
};
use novelai_bridge::SecretString;
use secrecy::ExposeSecret as _;

use crate::state::{DesktopState, GenerationRuntime};

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
            validation_fields: Vec::new(),
            code: ErrorCode::Unavailable,
            message: "请先配置 NovelAI API Key。".to_owned(),
        },
        JobError::Unresolved => ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unresolved,
            message: "当前创作有未解决的资源引用，请在解析面板中处理后再生成。".to_owned(),
        },
        JobError::Unavailable => ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unavailable,
            message: "生成队列已停止，请重新打开应用。未完成任务不会自动重新请求。".to_owned(),
        },
        JobError::Worker(_) => ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unavailable,
            message: "后台生成操作中断，请确认任务状态后重试。".to_owned(),
        },
        JobError::Bridge(novelai_bridge::BridgeError::Api(error)) => ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unavailable,
            message: format!("NovelAI 请求失败（HTTP {}）。", error.status()),
        },
        JobError::Bridge(novelai_bridge::BridgeError::Transport(_)) => ApiError {
            validation_fields: Vec::new(),
            code: ErrorCode::Unavailable,
            message: "无法连接 NovelAI。请求可能已被服务端处理，请确认后再重试。".to_owned(),
        },
        JobError::Bridge(novelai_bridge::BridgeError::InvalidRequest(error)) => ApiError {
            validation_fields: nib_app::api::request_error_fields(&error),
            code: ErrorCode::Invalid,
            message: error.to_string(),
        },
        error => ApiError {
            validation_fields: Vec::new(),
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
            validation_fields: Vec::new(),
            code: ErrorCode::Unavailable,
            message: "操作未完成，请重试。".to_owned(),
        })?
}

pub(crate) async fn with_generation<T: Send + 'static>(
    state: tauri::State<'_, DesktopState>,
    action: impl FnOnce(Arc<GenerationRuntime>) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let state = state.inner().clone();
    let guard = state.read_access().await;
    blocking(move || {
        let _guard = guard;
        let runtime = state.generation().map_err(generation_error)?;
        action(runtime)
    })
    .await
}

async fn with_generation_write<T: Send + 'static>(
    state: tauri::State<'_, DesktopState>,
    action: impl FnOnce(Arc<GenerationRuntime>) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let state = state.inner().clone();
    let guard = state
        .write_access()
        .await
        .map_err(crate::commands::persistence_error)?;
    blocking(move || {
        let _guard = guard;
        let runtime = state.generation().map_err(generation_error)?;
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
            .storage
            .settings
            .credentials()
            .map_err(crate::commands::persistence_error)
    })
    .await
}

fn account_id() -> String {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |time| time.as_nanos());
    format!(
        "credential-{timestamp:x}-{:x}",
        SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

#[tauri::command]
pub(crate) async fn save_account_key(
    state: tauri::State<'_, DesktopState>,
    id: Option<String>,
    name: String,
    key: Option<String>,
) -> Result<AccountStatus, ApiError> {
    let access = state
        .credential_change_access()
        .await
        .map_err(crate::commands::persistence_error)?;
    let desktop = state.inner().clone();
    blocking(move || {
        let _access = access;
        let name = name.trim();
        if name.is_empty() {
            return Err(generation_error(JobError::Invalid(
                "请输入账户名称。".into(),
            )));
        }
        let new_profile = id.is_none();
        let id = id.unwrap_or_else(account_id);
        let secret = key.map(SecretString::from);
        let secret = secret
            .as_ref()
            .map(|value| value.expose_secret().trim())
            .filter(|value| !value.is_empty())
            .map(|value| SecretString::from(value.to_owned()));
        if new_profile && secret.is_none() {
            return Err(generation_error(JobError::Invalid(
                "请输入 API Key。".into(),
            )));
        }
        let secret_id = secret.as_ref().map(|_| account_id());
        if let (Some(secret), Some(secret_id)) = (secret, secret_id.as_deref()) {
            nib_app::settings::validate_api_key(&secret)
                .map_err(|error| credential_error(&error))?;
            desktop
                .credentials
                .save(secret_id, secret)
                .map_err(|error| credential_error(&error))?;
        }
        if let Err(error) =
            desktop
                .storage
                .settings
                .save_credential(&id, name, secret_id.as_deref())
        {
            if let Some(secret_id) = secret_id
                && desktop.credentials.delete(&secret_id).is_err()
            {
                tracing::warn!("cannot remove unpublished credential version");
            }
            return Err(crate::commands::persistence_error(error));
        }
        desktop.invalidate_sdk().map_err(generation_error)?;
        desktop
            .storage
            .settings
            .credentials()
            .map_err(crate::commands::persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn activate_account(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<AccountStatus, ApiError> {
    let access = state
        .credential_change_access()
        .await
        .map_err(crate::commands::persistence_error)?;
    let desktop = state.inner().clone();
    blocking(move || {
        let _access = access;
        desktop
            .storage
            .settings
            .activate_credential(&id)
            .map_err(crate::commands::persistence_error)?;
        desktop.invalidate_sdk().map_err(generation_error)?;
        desktop
            .storage
            .settings
            .credentials()
            .map_err(crate::commands::persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_account_key(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<AccountStatus, ApiError> {
    let access = state
        .credential_change_access()
        .await
        .map_err(crate::commands::persistence_error)?;
    let desktop = state.inner().clone();
    blocking(move || {
        let _access = access;
        let versions = desktop
            .storage
            .settings
            .credential_versions(&id)
            .map_err(crate::commands::persistence_error)?;
        let database = desktop
            .database()
            .map_err(crate::commands::persistence_error)?;
        for version in &versions {
            if !database
                .unfinished_credential_jobs(version)
                .map_err(crate::commands::persistence_error)?
                .is_empty()
            {
                return Err(ApiError {
                    code: ErrorCode::Conflict,
                    message: "此账户仍有未完成任务。请在任务列表中取消或等待这些任务完成后再删除。"
                        .into(),
                    validation_fields: Vec::new(),
                });
            }
        }
        for version in versions {
            desktop
                .credentials
                .delete(&version)
                .map_err(|error| credential_error(&error))?;
        }
        desktop
            .storage
            .settings
            .delete_credential(&id)
            .map_err(crate::commands::persistence_error)?;
        desktop.invalidate_sdk().map_err(generation_error)?;
        desktop
            .storage
            .settings
            .credentials()
            .map_err(crate::commands::persistence_error)
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
) -> Result<GenerationBatch, ApiError> {
    with_generation_write(state, move |runtime| {
        runtime.queue.submit(&draft).map_err(generation_error)
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
            .queue
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
        runtime.queue.list(&query).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_job(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<JobRecord, ApiError> {
    with_generation(state, move |runtime| {
        runtime.queue.get(&id).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn cancel_job(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<JobRecord, ApiError> {
    with_generation_write(state, move |runtime| {
        runtime.queue.cancel(&id).map_err(generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn retry_job(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<JobRecord, ApiError> {
    with_generation_write(state, move |runtime| {
        runtime.queue.retry(&id).map_err(generation_error)
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
    let sdk = state.sdk().map_err(generation_error)?;
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
    let mut feedback = runtime.queue.subscribe();
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

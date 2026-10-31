//! The desktop owns verified update bytes and only launches installation after app preparation.

use std::sync::{Arc, Mutex};

use nib_app::{
    api::{ApiError, ErrorCode, UserMessage},
    updates::{UpdatePhase, UpdateRelease, UpdateStatus},
};
use tauri_plugin_updater::UpdaterExt as _;

use crate::state::DesktopState;

struct DownloadedUpdate {
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
}

struct State {
    status: UpdateStatus,
    candidate: Option<tauri_plugin_updater::Update>,
    downloaded: Option<DownloadedUpdate>,
}

/// One update operation at a time; status reads remain available throughout download/install.
pub(crate) struct Updates {
    state: Mutex<State>,
    operation: tokio::sync::Mutex<()>,
}

impl Updates {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(State {
                status: UpdateStatus {
                    enabled: !tauri::is_dev() && cfg!(all(windows, target_arch = "x86_64")),
                    current_version: env!("CARGO_PKG_VERSION").to_owned(),
                    phase: UpdatePhase::Idle,
                    release: None,
                    downloaded: 0,
                    total: None,
                    error: None,
                },
                candidate: None,
                downloaded: None,
            }),
            operation: tokio::sync::Mutex::new(()),
        }
    }

    fn state(&self) -> Result<std::sync::MutexGuard<'_, State>, ApiError> {
        self.state
            .lock()
            .map_err(|_poisoned| message_error(UserMessage::StorageLocked))
    }

    fn fail(&self, phase: UpdatePhase, error: &ApiError) {
        if let Ok(mut state) = self.state() {
            state.status.phase = phase;
            state.status.error = Some(error.message.clone());
        }
    }
}

fn message_error(message: UserMessage) -> ApiError {
    ApiError {
        code: ErrorCode::Unavailable,
        message,
        validation_fields: Vec::new(),
    }
}

#[expect(
    clippy::needless_pass_by_value,
    reason = "IPC error projection consumes updater errors through Result::map_err"
)]
fn updater_error(error: tauri_plugin_updater::Error) -> ApiError {
    tracing::warn!(error = ?error, "desktop update operation failed");
    message_error(UserMessage::External {
        detail: error.to_string(),
    })
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri commands receive managed State by value"
)]
pub(crate) fn get_update_status(
    updates: tauri::State<'_, Arc<Updates>>,
) -> Result<UpdateStatus, ApiError> {
    Ok(updates.state()?.status.clone())
}

#[tauri::command]
pub(crate) async fn check_for_update(
    handle: tauri::AppHandle,
    updates: tauri::State<'_, Arc<Updates>>,
) -> Result<UpdateStatus, ApiError> {
    let _operation = updates
        .operation
        .try_lock()
        .map_err(|_busy| message_error(UserMessage::UpdateInProgress))?;
    {
        let mut state = updates.state()?;
        if !state.status.enabled || state.downloaded.is_some() {
            return Ok(state.status.clone());
        }
        state.status.phase = UpdatePhase::Checking;
        state.status.error = None;
    }
    let result = async {
        handle
            .updater_builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()?
            .check()
            .await
    }
    .await;
    match result {
        Ok(candidate) => {
            let mut state = updates.state()?;
            state.status.release = candidate.as_ref().map(|update| UpdateRelease {
                version: update.version.clone(),
                notes: update.body.clone(),
            });
            state.status.phase = if candidate.is_some() {
                UpdatePhase::Available
            } else {
                UpdatePhase::Idle
            };
            state.candidate = candidate;
            Ok(state.status.clone())
        },
        Err(error) => {
            let error = updater_error(error);
            let phase = if updates.state()?.candidate.is_some() {
                UpdatePhase::Available
            } else {
                UpdatePhase::Idle
            };
            updates.fail(phase, &error);
            Err(error)
        },
    }
}

#[tauri::command]
pub(crate) async fn download_update(
    updates: tauri::State<'_, Arc<Updates>>,
) -> Result<UpdateStatus, ApiError> {
    let updates = Arc::clone(updates.inner());
    // Continue owning operation state if the invoking view disappears during a download.
    tauri::async_runtime::spawn(async move { download(&updates).await })
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "update download task failed");
            message_error(UserMessage::External {
                detail: error.to_string(),
            })
        })?
}

async fn download(updates: &Updates) -> Result<UpdateStatus, ApiError> {
    let _operation = updates
        .operation
        .try_lock()
        .map_err(|_busy| message_error(UserMessage::UpdateInProgress))?;
    let update = {
        let mut state = updates.state()?;
        if state.downloaded.is_some() {
            return Ok(state.status.clone());
        }
        let mut update = state
            .candidate
            .clone()
            .ok_or_else(|| message_error(UserMessage::UpdateUnavailable))?;
        update.timeout = Some(std::time::Duration::from_mins(30));
        state.status.phase = UpdatePhase::Downloading;
        state.status.downloaded = 0;
        state.status.total = None;
        state.status.error = None;
        update
    };
    tracing::info!(version = update.version, "downloading desktop update");
    match update
        .download(
            |chunk, total| {
                if let Ok(mut state) = updates.state() {
                    state.status.downloaded += chunk as u64;
                    if total.is_some() {
                        state.status.total = total;
                    }
                }
            },
            || {},
        )
        .await
    {
        Ok(bytes) => {
            let mut state = updates.state()?;
            state.downloaded = Some(DownloadedUpdate { update, bytes });
            state.status.phase = UpdatePhase::Ready;
            tracing::info!("desktop update downloaded and verified");
            Ok(state.status.clone())
        },
        Err(error) => {
            let error = updater_error(error);
            updates.fail(UpdatePhase::Available, &error);
            Err(error)
        },
    }
}

#[tauri::command]
pub(crate) async fn install_update(
    state: tauri::State<'_, DesktopState>,
    updates: tauri::State<'_, Arc<Updates>>,
) -> Result<(), ApiError> {
    let updates = Arc::clone(updates.inner());
    let app = state.app.clone();
    tauri::async_runtime::spawn(async move {
        let _operation = updates
            .operation
            .try_lock()
            .map_err(|_busy| message_error(UserMessage::UpdateInProgress))?;
        {
            let mut state = updates.state()?;
            if state.downloaded.is_none() {
                return Err(message_error(UserMessage::UpdateUnavailable));
            }
            state.status.phase = UpdatePhase::Installing;
            state.status.error = None;
        }
        let result = async {
            let guard = app
                .prepare_update()
                .await
                .map_err(crate::generation::generation_error)?;
            let downloaded = updates
                .state()?
                .downloaded
                .take()
                .ok_or_else(|| message_error(UserMessage::UpdateUnavailable))?;
            let updates = Arc::clone(&updates);
            crate::generation::blocking(move || {
                // Installation can exit this process. Keep exclusion owned by this blocking task.
                let _guard = guard;
                let result = downloaded
                    .update
                    .install(&downloaded.bytes)
                    .map_err(updater_error);
                updates.state()?.downloaded = Some(downloaded);
                result
            })
            .await
        }
        .await;
        if let Err(error) = &result {
            updates.fail(UpdatePhase::Ready, error);
        }
        result
    })
    .await
    .map_err(|error| {
        message_error(UserMessage::External {
            detail: error.to_string(),
        })
    })?
}

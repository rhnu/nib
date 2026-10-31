//! Paid generation uses a frozen batch and a single-use application-owned approval.

use std::sync::{Arc, atomic::Ordering};

use rig_core::{
    message::{ToolName, ToolResultContent},
    tool::{DynamicTool, ToolOutput},
};
use serde_json::json;

use super::{AgentApproval, AgentError, AgentPermission, AgentSnapshot, runtime::AgentRuntime};
use crate::{jobs::JobStatus, session::DraftLease, state::AppState};

pub(super) struct PendingApproval {
    id: String,
    decision: tokio::sync::oneshot::Sender<bool>,
}

impl PendingApproval {
    fn take(pending: &mut Option<Self>, id: &str, cancelled: bool) -> Result<Self, AgentError> {
        if cancelled || pending.as_ref().is_none_or(|request| request.id != id) {
            return Err(AgentError::Invalid(
                "This approval request is no longer active.",
            ));
        }
        pending.take().ok_or(AgentError::Locked)
    }
}

fn authorize_submission(permission: AgentPermission, approved: bool) -> Result<(), AgentError> {
    match permission {
        AgentPermission::Deny => Err(AgentError::Invalid(
            "Agent image generation is disabled in permissions.",
        )),
        AgentPermission::Ask if !approved => Err(AgentError::Invalid(
            "Generation permission changed. Request a new approval before submitting.",
        )),
        AgentPermission::Ask | AgentPermission::Allow => Ok(()),
    }
}

impl AgentRuntime {
    /// Resolves exactly one displayed request. Late, repeated and cancelled decisions are rejected.
    /// # Errors
    /// Returns a stale approval identity or unavailable runtime.
    pub fn approve(&self, id: &str, allow: bool) -> Result<AgentSnapshot, AgentError> {
        let mut pending = self
            .pending_approval
            .lock()
            .map_err(|_error| AgentError::Locked)?;
        let mut chat = self.chat.lock().map_err(|_error| AgentError::Locked)?;
        let request =
            PendingApproval::take(&mut pending, id, self.cancelled.load(Ordering::Acquire))?;
        chat.snapshot.approval = None;
        request
            .decision
            .send(allow)
            .map_err(|_closed| AgentError::Invalid("This approval request has ended."))?;
        tracing::info!(
            approval_id = id,
            allow,
            "assistant generation approval resolved"
        );
        Ok(chat.snapshot.clone())
    }

    async fn request_approval(&self, approval: AgentApproval) -> Result<(), AgentError> {
        let (decision, result) = tokio::sync::oneshot::channel();
        {
            let mut pending = self
                .pending_approval
                .lock()
                .map_err(|_error| AgentError::Locked)?;
            if pending.is_some() {
                return Err(AgentError::Busy);
            }
            let mut chat = self.chat.lock().map_err(|_error| AgentError::Locked)?;
            if self.cancelled.load(Ordering::Acquire) {
                return Err(AgentError::Cancelled);
            }
            *pending = Some(PendingApproval {
                id: approval.id.clone(),
                decision,
            });
            chat.snapshot.approval = Some(approval);
        }
        if !result.await.map_err(|_closed| AgentError::Cancelled)? {
            return Err(AgentError::Invalid(
                "The user denied this generation request. Do not retry it unless asked.",
            ));
        }
        Ok(())
    }
}

pub(super) fn tool(
    runtime: &Arc<AgentRuntime>,
    app: &AppState,
    lease: &Arc<DraftLease>,
) -> DynamicTool {
    let runtime = Arc::clone(runtime);
    let app = app.clone();
    let lease = Arc::clone(lease);
    DynamicTool::new(
        ToolName::new("generate_image").expect("static name"),
        "Generate using the saved current creation (text-to-image, image-to-image or inpainting). May spend Anlas. Application permission or user approval is required. Waits for this batch and returns saved result IDs plus up to four images for visual inspection. Never retry a denied request.",
        json!({"type":"object","properties":{},"additionalProperties":false}),
        move |_args| {
            let runtime = Arc::clone(&runtime);
            let app = app.clone();
            let lease = Arc::clone(&lease);
            Box::pin(async move {
                let _activity = runtime.tool_activity();
                let result = generate(&runtime, app, lease).await;
                let (output, ids) = match result {
                    Ok((output, ids)) => (Ok(output), ids),
                    Err(error) => (Err(error), vec![]),
                };
                super::tools::record_output(&runtime, "generate_image", output, ids)
            })
        },
    )
}

async fn generate(
    runtime: &Arc<AgentRuntime>,
    app: AppState,
    lease: Arc<DraftLease>,
) -> Result<(ToolOutput, Vec<String>), AgentError> {
    let permission = runtime.settings.agent_permission()?;
    if permission == AgentPermission::Deny {
        return Err(AgentError::Invalid(
            "Agent image generation is disabled in permissions.",
        ));
    }
    if runtime.cancelled.load(Ordering::Acquire) {
        return Err(AgentError::Cancelled);
    }
    let source = app.clone();
    let activity = runtime.tool_activity();
    let (queue, prepared, account_name) = tokio::task::spawn_blocking(move || {
        let _activity = activity;
        let queue = source.generation()?;
        let prepared = queue.prepare_batch(&lease.snapshot()?.draft)?;
        let account_name = source
            .settings()
            .credential_name_for_version(&prepared.credential_id)?;
        Ok::<_, AgentError>((queue, prepared, account_name))
    })
    .await
    .map_err(|_error| AgentError::Locked)??;
    let approved = match runtime.settings.agent_permission()? {
        AgentPermission::Ask => {
            runtime
                .request_approval(AgentApproval {
                    id: uuid::Uuid::new_v4().to_string(),
                    account_name,
                    quote: prepared.quote.clone(),
                })
                .await?;
            true
        },
        AgentPermission::Allow => false,
        AgentPermission::Deny => {
            return Err(AgentError::Invalid(
                "Agent image generation is disabled in permissions.",
            ));
        },
    };
    let worker = Arc::clone(runtime);
    let submission_queue = Arc::clone(&queue);
    let activity = runtime.tool_activity();
    let access = app.write_access().await?;
    let batch = tokio::task::spawn_blocking(move || {
        let _activity = activity;
        let _access = access;
        // Cancellation and admission serialize through the chat lock.
        let _chat = worker.chat.lock().map_err(|_error| AgentError::Locked)?;
        if worker.cancelled.load(Ordering::Acquire) {
            return Err(AgentError::Cancelled);
        }
        authorize_submission(worker.settings.agent_permission()?, approved)?;
        Ok::<_, AgentError>(submission_queue.submit_prepared(prepared)?)
    })
    .await
    .map_err(|_error| AgentError::Locked)??;
    tracing::info!(batch_id=%batch.batch_id, "assistant generation submitted");
    let mut changed = queue.subscribe_status();
    loop {
        if runtime.cancelled.load(Ordering::Acquire) {
            return Err(AgentError::Cancelled);
        }
        let query_queue = Arc::clone(&queue);
        let activity = runtime.tool_activity();
        let ids: Vec<_> = batch.jobs.iter().map(|job| job.id.clone()).collect();
        let jobs = tokio::task::spawn_blocking(move || {
            let _activity = activity;
            ids.iter()
                .map(|id| query_queue.get(id))
                .collect::<Result<Vec<_>, _>>()
        })
        .await
        .map_err(|_error| AgentError::Locked)??;
        if jobs
            .iter()
            .all(|job| !matches!(job.status, JobStatus::Queued | JobStatus::Running))
        {
            let source = app.clone();
            let worker = Arc::clone(runtime);
            let activity = runtime.tool_activity();
            return tokio::task::spawn_blocking(move || {
                let _activity = activity;
                let media = source.media()?;
                read_results(&worker, &media, &batch.batch_id, &jobs)
            })
            .await
            .map_err(|_error| AgentError::Locked)?;
        }
        tokio::select! { _ = changed.changed() => {}, () = tokio::time::sleep(std::time::Duration::from_secs(1)) => {} }
    }
}

/// Read completed batch images while preserving paid results even when visual preparation fails.
fn read_results(
    runtime: &AgentRuntime,
    media: &crate::media::MediaLibrary,
    batch_id: &str,
    jobs: &[crate::jobs::JobRecord],
) -> Result<(ToolOutput, Vec<String>), AgentError> {
    let mut content = vec![];
    let mut asset_ids = vec![];
    let mut image_errors = vec![];
    for id in jobs
        .iter()
        .flat_map(|job| &job.result_ids)
        .take(super::images::MAX_ATTACHMENTS)
    {
        let image = media
            .get_result(id)
            .map_err(AgentError::from)
            .and_then(|result| {
                runtime
                    .model_image(media, &result.asset_id)
                    .map(|image| (image, result.asset_id))
            });
        match image {
            Ok((image, asset_id)) => {
                content.push(ToolResultContent::Image(image));
                asset_ids.push(asset_id);
            },
            Err(error) => image_errors.push(json!({"resultId":id,"error":error.safe_message()})),
        }
    }
    // An image-read failure must not conceal a successful paid submission or
    // encourage generating it again. Saved job/result identities remain authoritative.
    content.insert(0, ToolResultContent::json(json!({"ok":jobs.iter().all(|job|job.status == JobStatus::Completed),"batchId":batch_id,"jobs":jobs.iter().map(|job|json!({"id":job.id,"status":job.status,"error":job.error,"resultIds":job.result_ids})).collect::<Vec<_>>(),"imageErrors":image_errors})));
    let output = ToolOutput::content(content).map_err(|_error| AgentError::Locked)?;
    Ok((output, asset_ids))
}

#[cfg(test)]
mod tests;

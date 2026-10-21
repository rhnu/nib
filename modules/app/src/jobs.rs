//! Frozen submissions and sequential execution through novelai-bridge.

mod sqlite;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use novelai_bridge::{
    ApiKeySource, Client, ClientConfig, GenerateImageRequest, ReqwestOptions, ReqwestTransport,
};
use serde::{Deserialize, Serialize};
pub(crate) use sqlite::{decode_submission, timestamp};
use tokio::sync::Notify;

use crate::{
    media::FinalOutputStore,
    persistence::PersistenceError,
    prompt::ResolvedDraft,
    session::{Draft, validate_draft},
    settings::{CredentialError, CredentialStore},
};

/// The effective SDK input and application sources are frozen once at submission.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct FrozenSubmission {
    pub resolved: ResolvedDraft,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub seed: i64,
    #[serde(skip)]
    pub(crate) request: GenerateImageRequest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum JobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct JobRecord {
    pub id: String,
    pub status: JobStatus,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub submitted_at: i64,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub finished_at: Option<i64>,
    pub error: Option<String>,
    pub result_ids: Vec<String>,
    pub submission: FrozenSubmission,
}

/// A local SDK estimate without subscription state, never a promised charge.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct GenerationQuote {
    pub resolved: ResolvedDraft,
    pub estimated_anlas: u32,
    pub account_specific: bool,
    pub too_expensive: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum JobError {
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
    #[error(transparent)]
    Bridge(#[from] novelai_bridge::BridgeError),
    #[error(transparent)]
    Credential(#[from] CredentialError),
    #[error("请先配置 NovelAI API Key。")]
    MissingCredentials,
    #[error("当前创作有未解决的资源引用。")]
    Unresolved,
    #[error("{0}")]
    Invalid(String),
    #[error("生成队列已停止，请重新打开应用。")]
    Unavailable,
    #[error("后台生成操作已中断。")]
    Worker(#[from] tokio::task::JoinError),
}

impl JobError {
    /// Returns a diagnostic suitable for IPC and permanent task failure metadata.
    pub fn user_message(&self) -> String { public_failure(self) }
}

struct ActiveJob {
    id: String,
    cancel: Arc<Notify>,
}

/// Retained task state belongs to scheduling, independently of its database backend.
pub trait JobStore: Send + Sync {
    /// # Errors
    /// Returns a backend failure while retaining the fixed input.
    fn insert_job(&self, submission: &FrozenSubmission) -> Result<JobRecord, PersistenceError>;

    /// # Errors
    /// Returns a missing task or a backend failure.
    fn get_job(&self, id: &str) -> Result<JobRecord, PersistenceError>;

    /// # Errors
    /// Returns a backend query or decoding failure.
    fn list_jobs(&self) -> Result<Vec<JobRecord>, PersistenceError>;

    /// Interrupts all queued/running tasks without issuing another paid request.
    ///
    /// # Errors
    /// Returns a backend write failure.
    fn interrupt_jobs(&self) -> Result<(), PersistenceError>;

    /// Atomically claims the oldest queued task.
    ///
    /// # Errors
    /// Returns a backend transaction failure.
    fn claim_job(&self) -> Result<Option<JobRecord>, PersistenceError>;

    /// Cancels only queued/running work; terminal states are preserved.
    ///
    /// # Errors
    /// Returns a missing task or a backend failure.
    fn cancel_job(&self, id: &str) -> Result<JobRecord, PersistenceError>;

    /// Marks failure only while the task is still running.
    ///
    /// # Errors
    /// Returns a backend write failure.
    fn fail_job(&self, id: &str, message: &str) -> Result<(), PersistenceError>;

    /// # Errors
    /// Returns a missing task or a backend read failure.
    fn job_running(&self, id: &str) -> Result<bool, PersistenceError> {
        Ok(self.get_job(id)?.status == JobStatus::Running)
    }
}

/// Submission resolves dependencies from one consistent resource snapshot.
pub trait SubmissionResolver: Send + Sync {
    /// # Errors
    /// Returns an underlying resource read failure.
    fn resolve(&self, draft: &Draft) -> Result<ResolvedDraft, PersistenceError>;
}

/// One application queue. The host owns the worker task and its lifetime.
pub struct JobQueue {
    store: Arc<dyn JobStore>,
    resolver: Arc<dyn SubmissionResolver>,
    media: Arc<dyn FinalOutputStore>,
    credentials: Arc<dyn CredentialStore>,
    wake: Notify,
    worker_started: AtomicBool,
    failed: AtomicBool,
    submission_gate: Mutex<()>,
    active: Mutex<Option<ActiveJob>>,
}

impl JobQueue {
    /// Opens a queue, interrupting unfinished retained jobs without resending them.
    ///
    /// # Errors
    /// Returns failures recovering retained state.
    pub fn new(
        store: Arc<dyn JobStore>,
        resolver: Arc<dyn SubmissionResolver>,
        media: Arc<dyn FinalOutputStore>,
        credentials: Arc<dyn CredentialStore>,
    ) -> Result<Arc<Self>, JobError> {
        store.interrupt_jobs()?;
        Ok(Arc::new(Self {
            store,
            resolver,
            media,
            credentials,
            wake: Notify::new(),
            worker_started: AtomicBool::new(false),
            failed: AtomicBool::new(false),
            submission_gate: Mutex::new(()),
            active: Mutex::new(None),
        }))
    }

    /// Resolves and validates locally without credentials or network access.
    ///
    /// # Errors
    /// Returns resource, SDK validation, preparation or storage failures.
    pub fn quote(&self, draft: &Draft) -> Result<GenerationQuote, JobError> {
        let submission = self.freeze(draft)?;
        let estimate = submission
            .request
            .estimate_anlas_cost(novelai_bridge::AnlasPricingContext::default())?;
        Ok(GenerationQuote {
            resolved: submission.resolved,
            estimated_anlas: estimate.total,
            account_specific: false,
            too_expensive: estimate.status == novelai_bridge::AnlasEstimateStatus::TooExpensive,
        })
    }

    /// Retains one fixed submission before notifying the sequential worker.
    ///
    /// # Errors
    /// Returns missing credentials, invalid content, SDK or storage failures.
    pub fn submit(&self, draft: &Draft) -> Result<JobRecord, JobError> {
        self.check_credentials()?;
        let submission = self.freeze(draft)?;
        self.enqueue(&submission)
    }

    /// Explicitly resubmits a failed, cancelled or interrupted frozen input.
    ///
    /// # Errors
    /// Returns missing credentials, invalid task state or storage failures.
    pub fn retry(&self, id: &str) -> Result<JobRecord, JobError> {
        self.check_credentials()?;
        let record = self.store.get_job(id)?;
        if !matches!(
            record.status,
            JobStatus::Failed | JobStatus::Cancelled | JobStatus::Interrupted
        ) {
            return Err(JobError::Invalid(
                "只能重试失败、取消或中断的任务。".to_owned(),
            ));
        }
        self.enqueue(&record.submission)
    }

    fn check_credentials(&self) -> Result<(), JobError> {
        if self.failed.load(Ordering::Acquire) {
            return Err(JobError::Unavailable);
        }
        if self.credentials.load()?.is_none() {
            return Err(JobError::MissingCredentials);
        }
        Ok(())
    }

    fn enqueue(&self, submission: &FrozenSubmission) -> Result<JobRecord, JobError> {
        let _gate = self
            .submission_gate
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if self.failed.load(Ordering::Acquire) {
            return Err(JobError::Unavailable);
        }
        let record = self.store.insert_job(submission)?;
        self.wake.notify_one();
        Ok(record)
    }

    /// Reads retained states, including interrupted jobs from earlier sessions.
    ///
    /// # Errors
    /// Returns storage or decoding failures.
    pub fn list(&self) -> Result<Vec<JobRecord>, JobError> { Ok(self.store.list_jobs()?) }

    /// Cancels queued or active work; remote cancellation cannot promise a refund.
    ///
    /// # Errors
    /// Returns missing-job or storage failures.
    pub fn cancel(&self, id: &str) -> Result<JobRecord, JobError> {
        let record = self.store.cancel_job(id)?;
        if let Some(active) = self
            .active
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?
            .as_ref()
            && active.id == id
        {
            active.cancel.notify_one();
        }
        Ok(record)
    }

    fn freeze(&self, draft: &Draft) -> Result<FrozenSubmission, JobError> {
        validate_draft(draft).map_err(|error| JobError::Invalid(error.to_string()))?;
        let resolved = self.resolver.resolve(draft)?;
        prepare_submission(resolved)
    }

    /// Runs the sole worker until the host drops its future or storage fails.
    ///
    /// # Errors
    /// Returns a fatal storage failure; submissions are then rejected until restart.
    pub async fn run(self: Arc<Self>) -> Result<(), JobError> {
        if self.worker_started.swap(true, Ordering::AcqRel) {
            return Ok(());
        }
        let result = self.run_inner().await;
        if let Err(error) = &result {
            report_failure("queue", error);
        }
        let _gate = self
            .submission_gate
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        self.failed.store(true, Ordering::Release);
        if let Err(error) = self.store.interrupt_jobs() {
            tracing::error!(error = %error, "cannot interrupt retained jobs after queue failure");
        }
        result
    }

    async fn run_inner(self: &Arc<Self>) -> Result<(), JobError> {
        loop {
            let store = Arc::clone(&self.store);
            let Some(next) = tokio::task::spawn_blocking(move || store.claim_job()).await?? else {
                self.wake.notified().await;
                continue;
            };
            let id = next.id.clone();
            let cancel = Arc::new(Notify::new());
            *self
                .active
                .lock()
                .map_err(|_poisoned| PersistenceError::Locked)? = Some(ActiveJob {
                id: id.clone(),
                cancel: Arc::clone(&cancel),
            });
            let queue = Arc::clone(self);
            // Joining each child makes panic a failed job instead of a stuck queue.
            // JoinSet aborts its child when the host drops the worker future.
            let mut task = tokio::task::JoinSet::new();
            task.spawn(async move { queue.execute(&next).await });
            tokio::select! {
                outcome = task.join_next() => {
                    let message = match outcome {
                        Some(Ok(Ok(()))) => None,
                        Some(Ok(Err(error))) => {
                            report_failure(&id, &error);
                            Some(public_failure(&error))
                        },
                        Some(Err(_)) | None => Some("生成执行过程已中断。".to_owned()),
                    };
                    if let Some(message) = message {
                        let store = Arc::clone(&self.store);
                        let failed_id = id.clone();
                        tokio::task::spawn_blocking(move || store.fail_job(&failed_id, &message)).await??;
                    }
                },
                () = cancel.notified() => {
                    task.abort_all();
                    while task.join_next().await.is_some() {}
                },
            }
            *self
                .active
                .lock()
                .map_err(|_poisoned| PersistenceError::Locked)? = None;
        }
    }

    async fn execute(self: &Arc<Self>, record: &JobRecord) -> Result<(), JobError> {
        let queue = Arc::clone(self);
        let id = record.id.clone();
        let transport = tokio::task::spawn_blocking(move || -> Result<_, JobError> {
            if !queue.store.job_running(&id)? {
                return Ok(None);
            }
            let value = queue
                .credentials
                .load()?
                .ok_or(JobError::MissingCredentials)?;
            Ok(Some(
                ReqwestTransport::new(ReqwestOptions {
                    api_key_source: ApiKeySource::Inline { value },
                    ..ReqwestOptions::default()
                })
                .map_err(novelai_bridge::BridgeError::from)?,
            ))
        })
        .await??;
        let Some(transport) = transport else {
            return Ok(());
        };
        let client = Client::new(Arc::new(transport), ClientConfig::default());
        let generated = client.generate(record.submission.request.clone()).await?;
        let media = Arc::clone(&self.media);
        let record = record.clone();
        tokio::task::spawn_blocking(move || media.retain(&record, generated)).await??;
        Ok(())
    }
}

pub(crate) fn prepare_submission(
    mut resolved: ResolvedDraft,
) -> Result<FrozenSubmission, JobError> {
    if !resolved.issues.is_empty() {
        return Err(JobError::Unresolved);
    }
    let settings = &resolved.settings;
    let prepared = GenerateImageRequest::builder(&resolved.positive, settings.model)
        .negative_prompt(&resolved.negative)
        .size(settings.size)
        .steps(settings.steps)
        .scale(settings.scale)
        .sampler(settings.sampler)
        .n_samples(1)
        .build()
        .normalize()?
        .prepare()?;
    let mut request = prepared.normalized().request().clone();
    request.core.seed = prepared.resolved_seed();
    resolved
        .positive
        .clone_from(&prepared.normalized().resolved_prompts().prompt);
    resolved
        .negative
        .clone_from(&prepared.normalized().resolved_prompts().negative_prompt);
    resolved.settings.size = request.core.size;
    resolved.settings.steps = request.sampling.steps;
    resolved.settings.scale = request.sampling.scale;
    resolved.settings.sampler = request.sampling.sampler;
    Ok(FrozenSubmission {
        resolved,
        seed: request.core.seed,
        request,
    })
}

// Provider response bodies and credential errors are never retained as public diagnostics.
fn public_failure(error: &JobError) -> String {
    match error {
        JobError::Bridge(novelai_bridge::BridgeError::Api(error)) => {
            format!("NovelAI 拒绝了请求（HTTP {}）。", error.status())
        },
        JobError::Bridge(novelai_bridge::BridgeError::Transport(_)) => {
            "无法连接 NovelAI，请求可能已被服务端处理并扣费。".to_owned()
        },
        JobError::Credential(_) => "无法读取系统凭据。".to_owned(),
        _ => error.to_string(),
    }
}

fn report_failure(id: &str, error: &JobError) {
    // Native credential errors and provider responses are deliberately not formatted.
    if let JobError::Persistence(error) = error {
        let mut causes = Vec::new();
        let mut source = std::error::Error::source(error);
        while let Some(cause) = source {
            causes.push(cause.to_string());
            source = cause.source();
        }
        tracing::error!(job_id = id, error = %error, causes = ?causes, "generation output persistence failed");
    } else {
        tracing::warn!(job_id = id, message = %public_failure(error), "generation failed");
    }
}

#[cfg(test)]
pub(crate) mod tests;

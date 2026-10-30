//! Frozen submissions and one sequential queue for all `NovelAI` operations.

use crate::api::UserMessage;

mod execution;
mod observation;
mod operations;
mod query;
mod sqlite;
mod vibe;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use novelai_bridge::{Client, GenerateImageRequest, Tokenizers};
pub use observation::{JobObservation, RequestSettlement};
pub use query::{JobPage, JobQuery, JobSummary, OperationSummary};
use serde::{Deserialize, Serialize};
pub(crate) use sqlite::{
    OPERATION_SUMMARY_SQL, decode_operation_summary, decode_submission, timestamp,
};
use tokio::sync::{Notify, broadcast};
pub use vibe::{VibeEncodingCandidate, VibeEncodingOutcome};

use crate::{
    media::{AssetReader, FinalOutputStore},
    persistence::PersistenceError,
    prompt::ResolvedDraft,
    session::Draft,
    settings::{CredentialError, CredentialStore, ExecutionPreferences},
};

/// Only applicable operation data is frozen. Generation images remain immutable asset references.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum FrozenSubmission {
    Generation {
        resolved: Box<ResolvedDraft>,
        diagnostics: Vec<ParameterDiagnostic>,
        #[cfg_attr(feature = "typegen", ts(type = "number"))]
        seed: i64,
        #[serde(skip)]
        request: Box<GenerateImageRequest>,
    },
    Director {
        asset_id: String,
        #[cfg_attr(feature = "typegen", ts(type = "\"normalize\" | \"reject\""))]
        policy: novelai_bridge::ValidationPolicy,
        diagnostics: Vec<ParameterDiagnostic>,
        #[cfg_attr(
            feature = "typegen",
            ts(
                type = "\"lineart\" | \"sketch\" | \"bg_removal\" | \"declutter\" | \"declutter_keep_bubbles\" | { emotion: { prompt: string; defry: number } } | { colorize: { prompt: string | null; defry: number } }"
            )
        )]
        command: novelai_bridge::DirectorCommand,
    },
    EncodeVibe {
        asset_id: String,
        #[cfg_attr(feature = "typegen", ts(type = "\"normalize\" | \"reject\""))]
        policy: novelai_bridge::ValidationPolicy,
        diagnostics: Vec<ParameterDiagnostic>,
        #[cfg_attr(feature = "typegen", ts(type = "string"))]
        model: novelai_bridge::Model,
        information_extracted: f32,
        mask_asset_id: Option<String>,
        crop_to_mask: Option<bool>,
        #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
        focus_seed: Option<i64>,
        #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
        info_extract_seed: Option<i64>,
    },
    Upscale {
        asset_id: String,
        diagnostics: Vec<ParameterDiagnostic>,
        #[cfg_attr(feature = "typegen", ts(type = "string"))]
        model: novelai_bridge::Model,
        #[cfg_attr(feature = "typegen", ts(type = "0 | 0.3 | 0.35 | 0.4 | 0.45 | 0.5"))]
        declared_blur_sigma: novelai_bridge::UpscaleBlurSigma,
    },
}

impl FrozenSubmission {
    pub const fn seed(&self) -> Option<i64> {
        match self {
            Self::Generation { seed, .. } => Some(*seed),
            _ => None,
        }
    }

    pub fn resolved(&self) -> Option<&ResolvedDraft> {
        match self {
            Self::Generation { resolved, .. } => Some(resolved),
            _ => None,
        }
    }

    pub const fn operation(&self) -> OperationKind {
        match self {
            Self::Generation { .. } => OperationKind::Generation,
            Self::Director { .. } => OperationKind::Director,
            Self::EncodeVibe { .. } => OperationKind::EncodeVibe,
            Self::Upscale { .. } => OperationKind::Upscale,
        }
    }

    pub fn diagnostics(&self) -> &[ParameterDiagnostic] {
        match self {
            Self::Generation { diagnostics, .. }
            | Self::Director { diagnostics, .. }
            | Self::EncodeVibe { diagnostics, .. }
            | Self::Upscale { diagnostics, .. } => diagnostics,
        }
    }
}

/// Display projection of an SDK normalization decision, without request payloads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ParameterDiagnostic {
    pub field: String,
    pub change: UserMessage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum OperationKind {
    Generation,
    Director,
    EncodeVibe,
    Upscale,
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
    pub batch_id: String,
    pub request_index: u32,
    pub request_count: u32,
    pub retry_of_job_id: Option<String>,
    pub credential_id: String,
    pub status: JobStatus,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub submitted_at: i64,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub finished_at: Option<i64>,
    pub error: Option<UserMessage>,
    pub result_ids: Vec<String>,
    pub submission: FrozenSubmission,
    pub execution: ExecutionPreferences,
    pub observation: Option<JobObservation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct TokenFieldUsage {
    pub field: String,
    pub used: u32,
    pub limit: u32,
    pub over_limit: bool,
}

/// One explicit operation creates all of its sequential request jobs atomically.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct GenerationBatch {
    pub batch_id: String,
    pub jobs: Vec<JobRecord>,
}

/// Estimates use SDK account context only when it has previously been sampled explicitly.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct GenerationQuote {
    pub request_count: u32,
    pub total_samples: u32,
    pub sample_limit: Option<u32>,
    pub per_request_estimated_anlas: Option<u32>,
    pub operation: OperationKind,
    pub resolved: Option<ResolvedDraft>,
    pub estimated_anlas: Option<u32>,
    // Input, expected output and pricing dimensions are distinct for Max Enhance.
    #[cfg_attr(
        feature = "typegen",
        ts(
            type = "{ input_size: { width: number; height: number }; output_size: { width: number; height: number }; pricing_size: { width: number; height: number } } | null"
        )
    )]
    pub geometry: Option<novelai_bridge::GenerationGeometry>,
    pub account_specific: bool,
    pub too_expensive: bool,
    pub tokens: Vec<TokenFieldUsage>,
    pub diagnostics: Vec<ParameterDiagnostic>,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub account_sampled_at: Option<i64>,
}

/// Transient feedback is bounded in memory and never becomes a final result.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum JobFeedback {
    ResyncRequired,
    Started {
        job_id: String,
    },
    Preview {
        job_id: String,
        sample_index: u32,
        step_index: u32,
        image_bytes: Vec<u8>,
        mime_type: Option<String>,
    },
    FinalReceived {
        job_id: String,
        sample_index: u32,
    },
    Finished {
        job_id: String,
        status: JobStatus,
        error: Option<UserMessage>,
        observation: Option<JobObservation>,
    },
    Observation {
        job_id: String,
        observation: JobObservation,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum JobError {
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
    #[error("无法读取输入素材：{source}")]
    InputMedia {
        #[source]
        source: PersistenceError,
    },
    #[error(transparent)]
    Bridge(#[from] novelai_bridge::BridgeError),
    #[error(transparent)]
    Credential(#[from] CredentialError),
    #[error("请先配置 NovelAI API Key。")]
    MissingCredentials,
    #[error("当前创作有未解决的资源引用。")]
    Unresolved,
    #[error("{0}")]
    Invalid(UserMessage),
    #[error("生成队列已停止，请重新打开应用。")]
    Unavailable,
    #[error("后台生成操作已中断。")]
    Worker(#[from] tokio::task::JoinError),
}

impl JobError {
    pub fn user_message(&self) -> UserMessage { public_failure(self) }
}

/// The host owns SDK construction, credential changes, shared account state and observation.
pub type SdkClient = Client<dyn novelai_bridge::Transport>;

pub trait SdkClientProvider: Send + Sync {
    /// Resolves credentials and constructs or reuses a local SDK client, without network I/O.
    /// # Errors
    /// Returns credential or SDK transport configuration errors.
    fn client(&self) -> Result<SdkClient, JobError>;

    /// Captures the immutable secret version selected for new submissions.
    /// # Errors
    /// Returns missing credentials or host settings failures.
    fn credential_id(&self) -> Result<String, JobError>;

    /// Schedules a fresh account sample after the request settles.
    fn request_settled(&self, _credential_id: &str, _execution: &ExecutionPreferences) {}

    /// Pricing and its sampling time are read from one immutable host-owned snapshot.
    fn account_sample(&self) -> Option<crate::settings::AccountSample> { None }

    /// Captures global execution options without opening a connection.
    /// # Errors
    /// Returns a settings read failure.
    fn execution_preferences(&self) -> Result<ExecutionPreferences, JobError> {
        Ok(ExecutionPreferences::default())
    }

    /// Uses the options retained with a queued job rather than the latest preferences.
    /// # Errors
    /// Returns credential or SDK transport configuration errors.
    fn client_for(
        &self,
        _execution: ExecutionPreferences,
        _credential_id: &str,
    ) -> Result<SdkClient, JobError> {
        self.client()
    }

    /// Selects a client and its corresponding account snapshot atomically in the host.
    /// # Errors
    /// Returns credential or SDK transport configuration errors.
    fn execution_context(
        &self,
        execution: ExecutionPreferences,
        credential_id: &str,
    ) -> Result<(SdkClient, Option<crate::settings::AccountSample>), JobError> {
        Ok((self.client_for(execution, credential_id)?, None))
    }
}

struct ActiveJob {
    id: String,
    cancel: Arc<Notify>,
}

pub trait JobStore: Send + Sync {
    /// # Errors
    /// Returns a backend failure retaining fixed input.
    fn insert_jobs(
        &self,
        submissions: &[FrozenSubmission],
        execution: ExecutionPreferences,
        credential_id: &str,
        retry_of_job_id: Option<&str>,
    ) -> Result<GenerationBatch, PersistenceError>;

    /// Lists unfinished requests holding the given secret version.
    /// # Errors
    /// Returns a storage query or decoding failure.
    fn unfinished_credential_jobs(
        &self,
        credential_id: &str,
    ) -> Result<Vec<String>, PersistenceError>;

    /// Reads completed local encodings with their full frozen input.
    /// # Errors
    /// Returns a storage query or decoding failure.
    fn vibe_encodings(&self) -> Result<Vec<VibeEncodingCandidate>, PersistenceError>;

    /// Retains SDK lifecycle evidence independently from application success or cancellation.
    /// # Errors
    /// Returns a backend failure.
    fn observe_job(&self, id: &str, observation: &JobObservation) -> Result<(), PersistenceError>;

    /// # Errors
    /// Returns missing task or backend failure.
    fn get_job(&self, id: &str) -> Result<JobRecord, PersistenceError>;

    /// # Errors
    /// Returns query or decoding failure.
    fn list_jobs(&self, query: &JobQuery) -> Result<JobPage, PersistenceError>;

    /// Interrupts retained unfinished jobs without issuing requests.
    /// # Errors
    /// Returns a backend failure.
    fn interrupt_jobs(&self) -> Result<(), PersistenceError>;

    /// Claims the oldest queued task atomically.
    /// # Errors
    /// Returns a backend failure.
    fn claim_job(&self) -> Result<Option<JobRecord>, PersistenceError>;

    /// # Errors
    /// Returns missing task or backend failure.
    fn cancel_job(&self, id: &str) -> Result<JobRecord, PersistenceError>;

    /// # Errors
    /// Returns a backend failure.
    fn fail_job(&self, id: &str, message: &UserMessage) -> Result<(), PersistenceError>;

    /// # Errors
    /// Returns missing task or backend failure.
    fn job_running(&self, id: &str) -> Result<bool, PersistenceError> {
        Ok(self.get_job(id)?.status == JobStatus::Running)
    }
}

pub trait SubmissionResolver: Send + Sync {
    /// # Errors
    /// Returns an underlying resource read failure.
    fn resolve(&self, draft: &Draft) -> Result<ResolvedDraft, PersistenceError>;
}

pub struct JobQueue {
    store: Arc<dyn JobStore>,
    resolver: Arc<dyn SubmissionResolver>,
    media: Arc<dyn FinalOutputStore>,
    credentials: Arc<dyn CredentialStore>,
    assets: Arc<dyn AssetReader>,
    clients: Arc<dyn SdkClientProvider>,
    tokenizers: Arc<Tokenizers>,
    feedback: broadcast::Sender<JobFeedback>,
    wake: Notify,
    worker_started: AtomicBool,
    failed: AtomicBool,
    paused: AtomicBool,
    idle: Notify,
    claim_gate: tokio::sync::Mutex<()>,
    submission_gate: Mutex<()>,
    active: Mutex<Option<ActiveJob>>,
}

impl JobQueue {
    /// Interrupts unfinished retained jobs; opening never resends a request.
    /// # Errors
    /// Returns retained-state recovery failures.
    pub fn new(
        store: Arc<dyn JobStore>,
        resolver: Arc<dyn SubmissionResolver>,
        media: Arc<dyn FinalOutputStore>,
        credentials: Arc<dyn CredentialStore>,
        assets: Arc<dyn AssetReader>,
        clients: Arc<dyn SdkClientProvider>,
        tokenizers: Arc<Tokenizers>,
    ) -> Result<Arc<Self>, JobError> {
        store.interrupt_jobs()?;
        let (feedback, _) = broadcast::channel(16);
        Ok(Arc::new(Self {
            store,
            resolver,
            media,
            credentials,
            assets,
            clients,
            tokenizers,
            feedback,
            wake: Notify::new(),
            worker_started: AtomicBool::new(false),
            failed: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            idle: Notify::new(),
            claim_gate: tokio::sync::Mutex::new(()),
            submission_gate: Mutex::new(()),
            active: Mutex::new(None),
        }))
    }

    pub fn subscribe(&self) -> broadcast::Receiver<JobFeedback> { self.feedback.subscribe() }

    /// Local resolution, token counts and estimation require no credentials or network.
    /// # Errors
    /// Returns resource, SDK validation, image or tokenizer failures.
    pub fn quote(&self, draft: &Draft) -> Result<GenerationQuote, JobError> {
        self.quote_draft(draft)
    }

    /// Persists fixed inputs before waking the sole worker.
    /// # Errors
    /// Returns missing credentials, validation or storage failures.
    pub fn submit(&self, draft: &Draft) -> Result<GenerationBatch, JobError> {
        let credential_id = self.clients.credential_id()?;
        self.check_credentials(&credential_id)?;
        let submissions = self.freeze_batch(draft)?;
        self.enqueue_with(
            &submissions,
            self.clients.execution_preferences()?,
            &credential_id,
            None,
        )
    }

    /// A retry is a new single-request batch retaining the original account and input.
    /// # Errors
    /// Returns unavailable original credentials, an ineligible state or storage failure.
    pub fn retry(&self, id: &str) -> Result<JobRecord, JobError> {
        let record = self.store.get_job(id)?;
        self.check_credentials(&record.credential_id)?;
        if !matches!(
            record.status,
            JobStatus::Failed | JobStatus::Cancelled | JobStatus::Interrupted
        ) {
            return Err(JobError::Invalid(UserMessage::RetryRequiresTerminalJob));
        }
        let batch = self.enqueue_with(
            &[record.submission],
            record.execution,
            &record.credential_id,
            Some(id),
        )?;
        batch.jobs.into_iter().next().ok_or_else(|| {
            PersistenceError::InvalidData {
                message: UserMessage::RetryJobMissing,
            }
            .into()
        })
    }

    fn check_credentials(&self, credential_id: &str) -> Result<(), JobError> {
        if self.failed.load(Ordering::Acquire) || self.paused.load(Ordering::Acquire) {
            return Err(JobError::Unavailable);
        }
        if self.credentials.load(credential_id)?.is_none() {
            return Err(JobError::MissingCredentials);
        }
        Ok(())
    }

    fn enqueue_with(
        &self,
        submissions: &[FrozenSubmission],
        execution: ExecutionPreferences,
        credential_id: &str,
        retry_of_job_id: Option<&str>,
    ) -> Result<GenerationBatch, JobError> {
        let _gate = self
            .submission_gate
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if self.failed.load(Ordering::Acquire) || self.paused.load(Ordering::Acquire) {
            return Err(JobError::Unavailable);
        }
        let batch =
            self.store
                .insert_jobs(submissions, execution, credential_id, retry_of_job_id)?;
        tracing::info!(
            batch_id = batch.batch_id,
            request_count = batch.jobs.len(),
            "queued generation operation"
        );
        self.wake.notify_one();
        Ok(batch)
    }

    /// Stops claiming requests and waits for the active request and durable result to settle.
    /// # Errors
    /// Returns a stopped worker or poisoned execution state.
    pub async fn pause_and_drain(&self) -> Result<(), JobError> {
        let gate = self.claim_gate.lock().await;
        self.paused.store(true, Ordering::Release);
        drop(gate);
        loop {
            let idle = self.idle.notified();
            if self.failed.load(Ordering::Acquire) {
                return Err(JobError::Unavailable);
            }
            if self
                .active
                .lock()
                .map_err(|_poisoned| PersistenceError::Locked)?
                .is_none()
            {
                break;
            }
            idle.await;
        }
        Ok(())
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::Release);
        self.wake.notify_one();
    }

    /// Lists unfinished requests that require the given immutable secret version.
    /// # Errors
    /// Returns a storage failure.
    pub fn unfinished_credential_jobs(&self, credential_id: &str) -> Result<Vec<String>, JobError> {
        Ok(self.store.unfinished_credential_jobs(credential_id)?)
    }

    /// # Errors
    /// Returns storage or decoding failures.
    pub fn list(&self, query: &JobQuery) -> Result<JobPage, JobError> {
        Ok(self.store.list_jobs(query)?)
    }

    /// Reads frozen inputs only when a task's details are requested.
    /// # Errors
    /// Returns an unknown task or backend failure.
    pub fn get(&self, id: &str) -> Result<JobRecord, JobError> { Ok(self.store.get_job(id)?) }

    /// Cancels queued work immediately; active streams settle asynchronously through the SDK.
    /// # Errors
    /// Returns missing task or storage failures.
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

    /// Runs one sequential worker, rejecting future submissions after fatal storage failure.
    /// # Errors
    /// Returns fatal backend failures.
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
            tracing::error!(error=%error,"cannot interrupt retained jobs after queue failure");
        }
        *self
            .active
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)? = None;
        self.idle.notify_one();
        result
    }
}

fn public_failure(error: &JobError) -> UserMessage {
    match error {
        JobError::Persistence(error) => error.user_message(),
        JobError::InputMedia { source } => UserMessage::InputMedia {
            message: Box::new(source.user_message()),
        },
        JobError::Credential(CredentialError::InvalidKey) => UserMessage::InvalidApiKey,
        JobError::Credential(_) => UserMessage::CredentialUnavailable,
        JobError::MissingCredentials => UserMessage::MissingCredentials,
        JobError::Unresolved => UserMessage::UnresolvedResources,
        JobError::Invalid(message) => message.clone(),
        JobError::Unavailable => UserMessage::QueueUnavailable,
        JobError::Worker(_) => UserMessage::WorkerInterrupted,
        // Provider responses and transport errors may echo rejected credentials.
        JobError::Bridge(novelai_bridge::BridgeError::Api(error)) => {
            UserMessage::ProviderHttpFailure {
                status: error.status(),
            }
        },
        JobError::Bridge(novelai_bridge::BridgeError::Transport(_)) => {
            UserMessage::ProviderTransportFailure
        },
        JobError::Bridge(novelai_bridge::BridgeError::Stream(_)) => {
            UserMessage::ProviderStreamFailure
        },
        JobError::Bridge(error) => UserMessage::external(crate::api::error_detail(error)),
    }
}

fn report_failure(id: &str, error: &JobError) {
    if let JobError::Persistence(error) = error {
        let mut causes = Vec::new();
        let mut source = std::error::Error::source(error);
        while let Some(cause) = source {
            causes.push(cause.to_string());
            source = cause.source();
        }
        tracing::error!(job_id=id,error=%error,causes=?causes,"operation persistence failed");
    } else {
        tracing::warn!(job_id=id,message=%public_failure(error),"operation failed");
    }
}

#[cfg(test)]
pub(crate) mod tests;

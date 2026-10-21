use novelai_bridge::{ApiError, ApiErrorReason};

use super::*;
use crate::prompt::{
    Composition, PromptNode, Resource, ResourceContent, ResourceReader, resolve_draft,
};

struct Resources {
    resource: Resource,
}

impl ResourceReader for Resources {
    fn get_resource(&self, id: &str) -> Result<Option<Resource>, PersistenceError> {
        Ok((self.resource.id == id).then(|| self.resource.clone()))
    }
}

impl SubmissionResolver for Resources {
    fn resolve(&self, draft: &Draft) -> Result<ResolvedDraft, PersistenceError> {
        resolve_draft(draft, self)
    }
}

pub(crate) fn submission() -> FrozenSubmission {
    let reader = Resources {
        resource: Resource {
            id: "chunk".to_owned(),
            revision: 1,
            name: "Original".to_owned(),
            content: ResourceContent::Chunk {
                text: "a cat".to_owned(),
            },
        },
    };
    let draft = Draft {
        composition: Composition {
            positive: vec![PromptNode::Chunk {
                id: "instance".to_owned(),
                enabled: true,
                resource_id: "chunk".to_owned(),
                override_text: None,
            }],
            negative: vec![PromptNode::Text {
                id: "negative".to_owned(),
                enabled: true,
                text: "blurry".to_owned(),
            }],
        },
        ..Draft::default()
    };
    prepare_submission(resolve_draft(&draft, &reader).unwrap()).unwrap()
}

#[test]
fn stored_input_roundtrip_keeps_seed_text_settings_and_sources() {
    let submitted = submission();
    let content = sqlite::encode_submission(&submitted).unwrap();
    let reopened = sqlite::decode_submission(&content).unwrap();
    assert_eq!(reopened, submitted);
    assert_eq!(reopened.seed, reopened.request.core.seed);
    assert_eq!(reopened.request.core.prompt, "a cat");
    assert_eq!(
        reopened.resolved.fragments[0].resource_id.as_deref(),
        Some("chunk")
    );
    assert_eq!(
        reopened.resolved.fragments[0].resource_name.as_deref(),
        Some("Original")
    );
}

#[test]
fn retained_data_and_ipc_each_have_one_effective_input_representation() {
    let submitted = submission();
    let retained: serde_json::Value =
        serde_json::from_str(&sqlite::encode_submission(&submitted).unwrap()).unwrap();
    assert!(retained.get("request").is_some());
    assert!(retained.get("resolved").is_none());
    let ipc = serde_json::to_value(&submitted).unwrap();
    assert!(ipc.get("request").is_none());
    assert!(ipc.get("resolved").is_some());
}

#[test]
fn snapshot_reports_normalized_settings_used_by_the_sdk() {
    let mut resolved = submission().resolved;
    resolved.positive = "a cat".to_owned();
    resolved.negative = "blurry".to_owned();
    resolved.settings.steps = 0;
    let prepared = prepare_submission(resolved).unwrap();
    assert!(prepared.resolved.settings.steps > 0);
    assert_eq!(
        prepared.resolved.settings.steps,
        prepared.request.sampling.steps
    );
    assert_eq!(prepared.seed, prepared.request.core.seed);
}

#[test]
fn provider_echoes_and_credential_causes_do_not_enter_public_failures() {
    let api = ApiError::from_response_parts(
        401,
        "https://image.novelai.net/ai/generate-image",
        None,
        Some(ApiErrorReason::Message("secret-provider-echo".to_owned())),
        Some("secret-body".to_owned()),
        false,
    );
    let message = JobError::Bridge(api.into()).user_message();
    assert!(message.contains("401"));
    assert!(!message.contains("secret"));
    let credential =
        CredentialError::failure("native failure", std::io::Error::other("secret-cause"));
    assert!(
        !JobError::Credential(credential)
            .user_message()
            .contains("secret")
    );
}

#[derive(Default)]
struct MemoryJobs {
    records: Mutex<Vec<JobRecord>>,
    claimed: Mutex<Vec<String>>,
    changed: Notify,
}

impl JobStore for MemoryJobs {
    fn insert_job(&self, submission: &FrozenSubmission) -> Result<JobRecord, PersistenceError> {
        let mut records = self.records.lock().unwrap();
        let record = JobRecord {
            id: (records.len() + 1).to_string(),
            status: JobStatus::Queued,
            submitted_at: 0,
            finished_at: None,
            error: None,
            result_ids: Vec::new(),
            submission: submission.clone(),
        };
        records.push(record.clone());
        Ok(record)
    }

    fn get_job(&self, id: &str) -> Result<JobRecord, PersistenceError> {
        self.records
            .lock()
            .unwrap()
            .iter()
            .find(|record| record.id == id)
            .cloned()
            .ok_or_else(|| PersistenceError::NotFound {
                kind: "job",
                id: id.to_owned(),
            })
    }

    fn list_jobs(&self) -> Result<Vec<JobRecord>, PersistenceError> {
        Ok(self.records.lock().unwrap().clone())
    }

    fn interrupt_jobs(&self) -> Result<(), PersistenceError> {
        for record in self.records.lock().unwrap().iter_mut() {
            if matches!(record.status, JobStatus::Queued | JobStatus::Running) {
                record.status = JobStatus::Interrupted;
            }
        }
        Ok(())
    }

    fn claim_job(&self) -> Result<Option<JobRecord>, PersistenceError> {
        let mut records = self.records.lock().unwrap();
        if records
            .iter()
            .any(|record| record.status == JobStatus::Running)
        {
            return Err(PersistenceError::InvalidData {
                message: "the worker claimed another task before finishing its current task"
                    .to_owned(),
            });
        }
        let Some(record) = records
            .iter_mut()
            .find(|record| record.status == JobStatus::Queued)
        else {
            return Ok(None);
        };
        record.status = JobStatus::Running;
        self.claimed.lock().unwrap().push(record.id.clone());
        Ok(Some(record.clone()))
    }

    fn cancel_job(&self, id: &str) -> Result<JobRecord, PersistenceError> {
        let mut records = self.records.lock().unwrap();
        let record = records
            .iter_mut()
            .find(|record| record.id == id)
            .ok_or_else(|| PersistenceError::NotFound {
                kind: "job",
                id: id.to_owned(),
            })?;
        if matches!(record.status, JobStatus::Queued | JobStatus::Running) {
            record.status = JobStatus::Cancelled;
        }
        Ok(record.clone())
    }

    fn fail_job(&self, id: &str, message: &str) -> Result<(), PersistenceError> {
        let mut records = self.records.lock().unwrap();
        let record = records.iter_mut().find(|record| record.id == id).unwrap();
        if record.status == JobStatus::Running {
            record.status = JobStatus::Failed;
            record.error = Some(message.to_owned());
        }
        self.changed.notify_one();
        Ok(())
    }
}

struct NoOutput {
    unexpected_call: Arc<AtomicBool>,
}

impl FinalOutputStore for NoOutput {
    fn retain(
        &self,
        _job: &JobRecord,
        _output: novelai_bridge::GenerateImageResult,
    ) -> Result<(), PersistenceError> {
        self.unexpected_call.store(true, Ordering::Release);
        Err(PersistenceError::InvalidData {
            message: "a credential failure cannot produce media".to_owned(),
        })
    }
}

struct TestCredentials {
    configured: bool,
    unexpected_call: Arc<AtomicBool>,
}

impl CredentialStore for TestCredentials {
    fn load(&self) -> Result<Option<novelai_bridge::SecretString>, CredentialError> {
        Ok(self.configured.then(|| "unit-test-only".to_owned().into()))
    }

    fn save(&self, _secret: novelai_bridge::SecretString) -> Result<(), CredentialError> {
        self.unexpected_call.store(true, Ordering::Release);
        Err(CredentialError::Locked)
    }

    fn delete(&self) -> Result<(), CredentialError> {
        self.unexpected_call.store(true, Ordering::Release);
        Err(CredentialError::Locked)
    }
}

fn memory_queue(store: Arc<MemoryJobs>, configured: bool) -> (Arc<JobQueue>, Arc<AtomicBool>) {
    let unexpected_call = Arc::new(AtomicBool::new(false));
    let queue = JobQueue::new(
        store,
        Arc::new(Resources {
            resource: Resource {
                id: "chunk".to_owned(),
                revision: 2,
                name: "Changed".to_owned(),
                content: ResourceContent::Chunk {
                    text: "changed text".to_owned(),
                },
            },
        }),
        Arc::new(NoOutput {
            unexpected_call: Arc::clone(&unexpected_call),
        }),
        Arc::new(TestCredentials {
            configured,
            unexpected_call: Arc::clone(&unexpected_call),
        }),
    )
    .unwrap();
    (queue, unexpected_call)
}

#[test]
fn recovery_interrupts_pending_work_and_explicit_retry_keeps_frozen_input() {
    let store = Arc::new(MemoryJobs::default());
    let original = store.insert_job(&submission()).unwrap();
    let (queue, unexpected_call) = memory_queue(Arc::clone(&store), true);
    assert_eq!(
        store.get_job(&original.id).unwrap().status,
        JobStatus::Interrupted
    );
    let retried = queue.retry(&original.id).unwrap();
    assert_ne!(retried.id, original.id);
    assert_eq!(retried.status, JobStatus::Queued);
    assert_eq!(retried.submission, original.submission);
    assert_eq!(retried.submission.request.core.prompt, "a cat");
    assert_eq!(
        store.claimed.lock().unwrap().len(),
        0,
        "recovery cannot start a paid request"
    );
    assert!(!unexpected_call.load(Ordering::Acquire));
}

#[tokio::test]
async fn credential_failures_release_the_queue_and_cancelled_jobs_are_skipped() {
    let store = Arc::new(MemoryJobs::default());
    let (queue, unexpected_call) = memory_queue(Arc::clone(&store), false);
    let frozen = submission();
    let cancelled = store.insert_job(&frozen).unwrap();
    queue.cancel(&cancelled.id).unwrap();
    let first = store.insert_job(&frozen).unwrap();
    let second = store.insert_job(&frozen).unwrap();
    let worker = tokio::spawn(Arc::clone(&queue).run());
    let completion = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let changed = store.changed.notified();
            if store.get_job(&second.id).unwrap().status == JobStatus::Failed {
                break;
            }
            changed.await;
        }
    })
    .await;
    worker.abort();
    let stopped = worker
        .await
        .expect_err("the host explicitly stopped the worker");
    assert!(
        stopped.is_cancelled(),
        "an unexpected worker panic cannot pass as shutdown"
    );
    completion.expect("failed tasks should release the queue");
    assert_eq!(
        store.get_job(&cancelled.id).unwrap().status,
        JobStatus::Cancelled
    );
    assert_eq!(store.get_job(&first.id).unwrap().status, JobStatus::Failed);
    assert_eq!(*store.claimed.lock().unwrap(), [first.id, second.id]);
    assert!(!unexpected_call.load(Ordering::Acquire));
}

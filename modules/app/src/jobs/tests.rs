use novelai_bridge::{ApiError, ApiErrorReason};

use super::{operations::prepare_submission, *};
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
    prepare_submission(resolve_draft(&draft, &reader).unwrap(), &NoAssets).unwrap()
}

#[test]
fn stored_input_roundtrip_keeps_seed_text_settings_and_sources() {
    let original = submission();
    let mut resolved = original.resolved().unwrap().clone();
    resolved.positive = request(&original).core.prompt.clone();
    resolved.negative = request(&original).core.negative_prompt.clone().unwrap();
    resolved.settings.model = novelai_bridge::Model::NaiDiffusion45Full;
    resolved.characters = vec![
        crate::prompt::ResolvedCharacter {
            id: "disabled-character".to_owned(),
            enabled: false,
            positive: "unused prompt".to_owned(),
            negative: "unused negative".to_owned(),
            position: novelai_bridge::CharacterPosition::default(),
            fragments: Vec::new(),
            preset_instance_id: None,
            resource_id: None,
            expanded: true,
            overridden: false,
        },
        crate::prompt::ResolvedCharacter {
            id: "active-character".to_owned(),
            enabled: true,
            positive: "red hair".to_owned(),
            negative: "blue hair".to_owned(),
            position: novelai_bridge::CharacterPosition { x: 0.2, y: 0.8 },
            fragments: resolved.fragments.clone(),
            preset_instance_id: Some("recipe-instance".to_owned()),
            resource_id: Some("recipe".to_owned()),
            expanded: false,
            overridden: true,
        },
    ];
    let submitted = prepare_submission(resolved, &NoAssets).unwrap();
    let content = sqlite::encode_submission(&submitted).unwrap();
    let reopened = sqlite::decode_submission(&content).unwrap();
    assert_eq!(reopened, submitted);
    assert_eq!(reopened.seed(), Some(request(&reopened).core.seed));
    assert_eq!(request(&reopened).core.prompt, "a cat");
    let character = &reopened.resolved().unwrap().characters[1];
    assert_eq!(character.id, "active-character");
    assert_eq!(character.positive, "red hair");
    assert_eq!(character.negative, "blue hair");
    assert_eq!(
        character.preset_instance_id.as_deref(),
        Some("recipe-instance")
    );
    assert!(character.overridden);
    assert!(!reopened.resolved().unwrap().characters[0].enabled);
    let retained: serde_json::Value = serde_json::from_str(&content).unwrap();
    let character_source = &retained["characters"][1];
    assert!(character_source.get("positive").is_none());
    assert!(character_source.get("negative").is_none());
    assert!(character_source.get("position").is_none());
    assert!(character_source.get("enabled").is_none());
    assert_eq!(
        reopened.resolved().unwrap().fragments[0]
            .resource_id
            .as_deref(),
        Some("chunk")
    );
    assert_eq!(
        reopened.resolved().unwrap().fragments[0]
            .resource_name
            .as_deref(),
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
    let mut resolved = submission().resolved().unwrap().clone();
    resolved.positive = "a cat".to_owned();
    resolved.negative = "blurry".to_owned();
    resolved.settings.steps = 0;
    let prepared = prepare_submission(resolved, &NoAssets).unwrap();
    assert!(prepared.resolved().unwrap().settings.steps > 0);
    assert_eq!(
        prepared.resolved().unwrap().settings.steps,
        request(&prepared).sampling.steps
    );
    assert_eq!(prepared.seed(), Some(request(&prepared).core.seed));
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
    fn insert_job(
        &self,
        submission: &FrozenSubmission,
        execution: ExecutionPreferences,
    ) -> Result<JobRecord, PersistenceError> {
        let mut records = self.records.lock().unwrap();
        let record = JobRecord {
            id: (records.len() + 1).to_string(),
            status: JobStatus::Queued,
            submitted_at: 0,
            finished_at: None,
            error: None,
            result_ids: Vec::new(),
            submission: submission.clone(),
            execution,
            observation: None,
        };
        records.push(record.clone());
        Ok(record)
    }

    fn observe_job(&self, id: &str, observation: &JobObservation) -> Result<(), PersistenceError> {
        self.records
            .lock()
            .unwrap()
            .iter_mut()
            .find(|record| record.id == id)
            .unwrap()
            .observation = Some(observation.clone());
        self.changed.notify_one();
        Ok(())
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

    fn list_jobs(&self, query: &JobQuery) -> Result<JobPage, PersistenceError> {
        let records = self.records.lock().unwrap();
        let active = records
            .iter()
            .filter(|record| matches!(record.status, JobStatus::Queued | JobStatus::Running))
            .map(JobSummary::from)
            .collect();
        let mut items: Vec<_> = records
            .iter()
            .rev()
            .filter(|record| !matches!(record.status, JobStatus::Queued | JobStatus::Running))
            .filter(|record| {
                query.before.as_deref().is_none_or(|before| {
                    record.id.parse::<u64>().unwrap() < before.parse::<u64>().unwrap()
                })
            })
            .take(query.limit as usize + 1)
            .map(JobSummary::from)
            .collect();
        let next_cursor = if items.len() > query.limit as usize {
            items.pop();
            items.last().map(|record| record.id.clone())
        } else {
            None
        };
        Ok(JobPage {
            items,
            active,
            next_cursor,
        })
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
        _output: crate::media::JobOutput,
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
        Arc::new(NoAssets),
        Arc::new(NoClient),
        Arc::new(Tokenizers::new()),
    )
    .unwrap();
    (queue, unexpected_call)
}

#[test]
fn recovery_interrupts_pending_work_and_explicit_retry_keeps_frozen_input() {
    let store = Arc::new(MemoryJobs::default());
    let execution = ExecutionPreferences {
        image_base_url: Some("https://example.test/novelai".to_owned()),
        image_request_encoding: crate::settings::ImageRequestEncoding::Multipart,
        server_image_cache: true,
    };
    let original = store.insert_job(&submission(), execution.clone()).unwrap();
    let (queue, unexpected_call) = memory_queue(Arc::clone(&store), true);
    assert_eq!(
        store.get_job(&original.id).unwrap().status,
        JobStatus::Interrupted
    );
    let retried = queue.retry(&original.id).unwrap();
    assert_ne!(retried.id, original.id);
    assert_eq!(retried.status, JobStatus::Queued);
    assert_eq!(retried.submission, original.submission);
    assert_eq!(retried.execution, execution);
    assert_eq!(request(&retried.submission).core.prompt, "a cat");
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
    let cancelled = store
        .insert_job(&frozen, ExecutionPreferences::default())
        .unwrap();
    queue.cancel(&cancelled.id).unwrap();
    let first = store
        .insert_job(&frozen, ExecutionPreferences::default())
        .unwrap();
    let second = store
        .insert_job(&frozen, ExecutionPreferences::default())
        .unwrap();
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

fn request(submission: &FrozenSubmission) -> &GenerateImageRequest {
    let FrozenSubmission::Generation { request, .. } = submission else {
        panic!("expected generation")
    };
    request
}

struct NoAssets;

impl crate::media::AssetReader for NoAssets {
    fn image(&self, id: &str) -> Result<novelai_bridge::EncodedImage, PersistenceError> {
        Err(PersistenceError::NotFound {
            kind: "image asset",
            id: id.to_owned(),
        })
    }

    fn vibe(&self, id: &str) -> Result<novelai_bridge::VibeEncoding, PersistenceError> {
        Err(PersistenceError::NotFound {
            kind: "vibe asset",
            id: id.to_owned(),
        })
    }
}

struct NoClient;

impl SdkClientProvider for NoClient {
    fn client(&self) -> Result<SdkClient, JobError> { Err(JobError::MissingCredentials) }
}

mod account;
use account::sampled_account;

mod inputs;
mod stream;

struct ImageAssets;

impl crate::media::AssetReader for ImageAssets {
    fn image(&self, id: &str) -> Result<novelai_bridge::EncodedImage, PersistenceError> {
        if id != "source" {
            return Err(PersistenceError::NotFound {
                kind: "image asset",
                id: id.to_owned(),
            });
        }
        novelai_bridge::EncodedImage::from_base64("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=")
            .map_err(|error|PersistenceError::failure("decode unit test image",error))
    }

    fn vibe(&self, id: &str) -> Result<novelai_bridge::VibeEncoding, PersistenceError> {
        Err(PersistenceError::NotFound {
            kind: "vibe asset",
            id: id.to_owned(),
        })
    }
}

#[test]
fn director_ignores_unrelated_prompt_dependencies_and_keeps_sdk_adjustments() {
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    Arc::get_mut(&mut queue).unwrap().assets = Arc::new(ImageAssets);
    let mut draft = Draft::default();
    draft.composition.positive.push(PromptNode::Chunk {
        id: "unrelated".to_owned(),
        enabled: true,
        resource_id: "absent".to_owned(),
        override_text: None,
    });
    draft.inputs.operation = crate::session::CreationOperation::Director {
        asset_id: "source".to_owned(),
        command: novelai_bridge::DirectorCommand::Emotion {
            prompt: "  happy  ".to_owned(),
            defry: 255,
        },
    };
    let frozen = queue.freeze(&draft).unwrap();
    assert!(frozen.resolved().is_none());
    assert!(frozen.seed().is_none());
    assert_ne!(frozen.diagnostics(), &[]);
    let encoded = sqlite::encode_submission(&frozen).unwrap();
    assert!(!encoded.contains("request"));
    assert!(!encoded.contains("steps"));
    assert_eq!(sqlite::decode_submission(&encoded).unwrap(), frozen);
    let FrozenSubmission::Director { command, .. } = frozen else {
        panic!("expected Director")
    };
    assert!(
        matches!(command,novelai_bridge::DirectorCommand::Emotion {prompt,defry:5} if prompt=="happy")
    );
    let quote = queue.quote(&draft).unwrap();
    assert!(quote.resolved.is_none());
    assert!(quote.tokens.is_empty());
    assert!(!quote.account_specific);
}

#[test]
fn image_submission_stores_only_parameters_and_immutable_input_ids() {
    let mut resolved = submission().resolved().unwrap().clone();
    resolved.inputs.operation = crate::session::CreationOperation::ImageToImage {
        asset_id: "source".to_owned(),
        strength: 4.0,
        noise: 0.0,
        color_correct: true,
        extra_noise_seed: Some(123),
        add_original_image: true,
        max_enhance: false,
    };
    let frozen = prepare_submission(resolved, &ImageAssets).unwrap();
    let encoded = sqlite::encode_submission(&frozen).unwrap();
    assert!(!encoded.contains("iVBOR"));
    assert!(encoded.contains("source"));
    let reopened = sqlite::decode_submission(&encoded).unwrap();
    assert_eq!(reopened, frozen);
    let hydrated = operations::hydrate(
        request(&reopened).clone(),
        &reopened.resolved().unwrap().inputs,
        &ImageAssets,
    )
    .unwrap();
    let novelai_bridge::GenerationInput::ImageToImage(input) = hydrated.operation else {
        panic!("expected image input")
    };
    assert!(input.strength < 1.0);
    assert_eq!(input.extra_noise_seed, Some(123));
    assert_ne!(frozen.diagnostics(), &[]);
}

#[test]
fn implicit_noise_seed_is_frozen_from_the_sdk_effective_payload() {
    let mut resolved = submission().resolved().unwrap().clone();
    resolved.inputs.operation = crate::session::CreationOperation::ImageToImage {
        asset_id: "source".to_owned(),
        strength: 0.5,
        noise: 0.0,
        color_correct: true,
        extra_noise_seed: None,
        add_original_image: true,
        max_enhance: false,
    };
    let raw = operations::hydrate(
        resolved.generation_request(),
        &resolved.inputs,
        &ImageAssets,
    )
    .unwrap();
    let prepared = raw.normalize().unwrap().prepare().unwrap();
    let encoded = prepared
        .encode(novelai_bridge::GenerationDelivery::Images)
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&encoded).unwrap();
    resolved.settings.seed = prepared.resolved_seed();
    for stream in [None, Some(novelai_bridge::StreamMode::Sse)] {
        resolved.inputs.stream = stream;
        let frozen = prepare_submission(resolved.clone(), &ImageAssets).unwrap();
        let crate::session::CreationOperation::ImageToImage {
            extra_noise_seed, ..
        } = &frozen.resolved().unwrap().inputs.operation
        else {
            panic!("expected image input")
        };
        assert_eq!(
            *extra_noise_seed,
            body["parameters"]["extra_noise_seed"].as_i64()
        );
        assert!(extra_noise_seed.is_some());
    }
}

#[test]
fn vibe_encoding_freezes_only_applicable_sdk_effective_input() {
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    Arc::get_mut(&mut queue).unwrap().assets = Arc::new(ImageAssets);
    let mut draft = Draft::default();
    draft.inputs.operation =
        crate::session::CreationOperation::EncodeVibe(crate::session::VibeEncodingInput {
            asset_id: "source".to_owned(),
            model: novelai_bridge::Model::NaiDiffusion45Full,
            information_extracted: 9.0,
            mask_asset_id: Some("source".to_owned()),
            crop_to_mask: Some(true),
            focus_seed: Some(123),
            info_extract_seed: Some(456),
        });
    let frozen = queue.freeze(&draft).unwrap();
    assert!(frozen.resolved().is_none());
    assert!(frozen.seed().is_none());
    assert_ne!(frozen.diagnostics(), &[]);
    let encoded = sqlite::encode_submission(&frozen).unwrap();
    assert!(!encoded.contains("steps"));
    assert!(!encoded.contains("iVBOR"));
    assert_eq!(sqlite::decode_submission(&encoded).unwrap(), frozen);
    let FrozenSubmission::EncodeVibe {
        information_extracted,
        mask_asset_id,
        crop_to_mask,
        focus_seed,
        info_extract_seed,
        ..
    } = frozen
    else {
        panic!("expected Vibe encoding")
    };
    assert!((information_extracted - 1.0).abs() < f32::EPSILON);
    assert_eq!(mask_asset_id.as_deref(), Some("source"));
    assert_eq!(crop_to_mask, Some(true));
    assert_eq!(focus_seed, Some(123));
    assert_eq!(info_extract_seed, Some(456));
}

mod policy;

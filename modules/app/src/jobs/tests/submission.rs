//! Batch identity, explicit submission and reuse are verified without remote requests.
use super::*;

#[test]
fn blank_prompts_can_be_quoted_and_submitted_with_enabled_characters() {
    for policy in [
        novelai_bridge::ValidationPolicy::Normalize,
        novelai_bridge::ValidationPolicy::Reject,
    ] {
        for character_negative in [None, Some(""), Some("blurry")] {
            let (mut queue, unexpected_call) = memory_queue(Arc::new(MemoryJobs::default()), true);
            Arc::get_mut(&mut queue).unwrap().tokenizers = Arc::new(Tokenizers::bundled().unwrap());
            let mut draft = Draft::default();
            draft.settings.quality = Some(novelai_bridge::QualityPreset::None);
            draft.settings.uc_preset = Some(novelai_bridge::UcPreset::None);
            draft.settings.seed = Some(42);
            draft.inputs.policy = policy;
            if let Some(negative) = character_negative {
                draft.characters.push(crate::prompt::CharacterComposition {
                    id: "character".to_owned(),
                    enabled: true,
                    position: novelai_bridge::CharacterPosition::default(),
                    composition: Composition {
                        positive: Vec::new(),
                        negative: vec![PromptNode::Text {
                            id: "negative".to_owned(),
                            enabled: true,
                            text: negative.to_owned(),
                        }],
                    },
                });
            }
            let quote = queue.quote(&draft).unwrap();
            let quoted = quote.resolved.unwrap();
            assert_eq!(quoted.positive, "");
            assert_eq!(quoted.negative, "");
            let batch = queue.submit(&draft).unwrap();
            assert_eq!(batch.jobs.len(), 1);
            let submitted = batch.jobs[0].submission.resolved().unwrap();
            assert_eq!(submitted.positive, "");
            assert_eq!(submitted.negative, "");
            if let Some(negative) = character_negative {
                assert_eq!(submitted.characters.len(), 1);
                assert!(submitted.characters[0].enabled);
                assert_eq!(submitted.characters[0].positive, "");
                assert_eq!(submitted.characters[0].negative, negative);
            }
            assert!(!unexpected_call.load(Ordering::Acquire));
        }
    }
}

#[test]
fn batch_submission_keeps_request_identity_and_fixed_seed() {
    let store = Arc::new(MemoryJobs::default());
    let (queue, _) = memory_queue(Arc::clone(&store), true);
    let draft = Draft {
        composition: Composition {
            positive: vec![PromptNode::Text {
                id: "text".to_owned(),
                enabled: true,
                text: "a bird".to_owned(),
            }],
            negative: Vec::new(),
        },
        settings: crate::prompt::GenerationSettings {
            seed: Some(123),
            n_samples: Some(2),
            ..Default::default()
        },
        inputs: crate::session::CreationInputs {
            request_count: 3,
            ..Default::default()
        },
        ..Default::default()
    };
    let batch = queue.submit(&draft).unwrap();
    assert_eq!(batch.jobs.len(), 3);
    for (index, job) in batch.jobs.iter().enumerate() {
        assert_eq!(job.batch_id, batch.batch_id);
        assert_eq!(job.request_index, u32::try_from(index).unwrap());
        assert_eq!(job.request_count, 3);
        assert_eq!(job.credential_id, "test-account");
        assert_eq!(job.submission.seed(), Some(123));
        assert_eq!(request(&job.submission).core.n_samples, 2);
    }
    assert_eq!(store.records.lock().unwrap().len(), 3);
}

#[test]
fn invalid_batch_count_does_not_enqueue_partial_work() {
    let store = Arc::new(MemoryJobs::default());
    let (queue, _) = memory_queue(Arc::clone(&store), true);
    let mut draft = Draft::default();
    draft.inputs.request_count = 9;
    assert!(matches!(queue.submit(&draft), Err(JobError::Invalid(_))));
    assert!(store.records.lock().unwrap().is_empty());
}

#[test]
fn quote_prices_all_requests_and_uses_the_actual_sample_limit() {
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    Arc::get_mut(&mut queue).unwrap().tokenizers = Arc::new(Tokenizers::bundled().unwrap());
    let draft = Draft {
        composition: Composition {
            positive: vec![PromptNode::Text {
                id: "text".to_owned(),
                enabled: true,
                text: "a bird".to_owned(),
            }],
            negative: Vec::new(),
        },
        settings: crate::prompt::GenerationSettings {
            size: Some(novelai_bridge::ImageSize {
                width: 512,
                height: 512,
            }),
            n_samples: Some(8),
            ..Default::default()
        },
        inputs: crate::session::CreationInputs {
            request_count: 3,
            ..Default::default()
        },
        ..Default::default()
    };
    let quote = queue.quote(&draft).unwrap();
    assert_eq!(quote.request_count, 3);
    assert_eq!(quote.total_samples, 24);
    assert_eq!(quote.sample_limit, Some(8));
    assert_eq!(
        quote.estimated_anlas,
        quote.per_request_estimated_anlas.map(|value| value * 3)
    );
}

#[test]
fn unsupported_streaming_retains_ordinary_generation() {
    let (queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    let draft = Draft {
        composition: Composition {
            positive: vec![PromptNode::Text {
                id: "text".to_owned(),
                enabled: true,
                text: "a bird".to_owned(),
            }],
            negative: Vec::new(),
        },
        settings: crate::prompt::GenerationSettings {
            model: Some(novelai_bridge::Model::NaiDiffusion3),
            ..Default::default()
        },
        ..Default::default()
    };
    let frozen = queue.freeze_batch(&draft).unwrap();
    assert_eq!(frozen.len(), 1);
    assert!(frozen[0].resolved().unwrap().inputs.stream.is_none());
}

#[tokio::test]
async fn draining_pauses_new_submissions_until_resumed() {
    let (queue, _) = memory_queue(Arc::new(MemoryJobs::default()), true);
    queue.pause_and_drain().await.unwrap();
    assert!(matches!(
        queue.submit(&Draft::default()),
        Err(JobError::Unavailable)
    ));
    queue.resume();
    let batch = queue.submit(&Draft::default()).unwrap();
    assert_eq!(batch.jobs.len(), 1);
}

#[test]
fn slot_encoding_reuses_only_the_complete_matching_encoding_input() {
    struct EncodingAssets;
    impl crate::media::AssetReader for EncodingAssets {
        fn image(&self, id: &str) -> Result<novelai_bridge::EncodedImage, PersistenceError> {
            ImageAssets.image(id)
        }

        fn vibe(&self, _id: &str) -> Result<novelai_bridge::VibeEncoding, PersistenceError> {
            novelai_bridge::VibeEncoding::from_bytes(vec![1, 2, 3])
                .map_err(|error| PersistenceError::failure("unit test encoding", error))
        }
    }
    let store = Arc::new(MemoryJobs::default());
    let (mut queue, _) = memory_queue(Arc::clone(&store), true);
    Arc::get_mut(&mut queue).unwrap().assets = Arc::new(EncodingAssets);
    let input = crate::session::VibeEncodingInput {
        asset_id: "source".to_owned(),
        model: novelai_bridge::Model::NaiDiffusion45Full,
        information_extracted: 0.6,
        mask_asset_id: None,
        crop_to_mask: None,
        focus_seed: Some(5),
        info_extract_seed: Some(8),
    };
    let draft = Draft {
        inputs: crate::session::CreationInputs {
            operation: crate::session::CreationOperation::EncodeVibe(input.clone()),
            ..Default::default()
        },
        ..Default::default()
    };
    store.vibes.lock().unwrap().push((
        queue
            .encoding_key(&queue.freeze(&draft).unwrap())
            .unwrap()
            .unwrap(),
        "encoding".to_owned(),
    ));
    let reused = queue
        .ensure_vibe_encoding(input.clone(), novelai_bridge::ValidationPolicy::Normalize)
        .unwrap();
    assert!(matches!(reused, VibeEncodingOutcome::Reused { asset_id } if asset_id == "encoding"));
    assert!(store.records.lock().unwrap().is_empty());
    let changed = crate::session::VibeEncodingInput {
        focus_seed: Some(6),
        ..input
    };
    assert!(matches!(
        queue
            .ensure_vibe_encoding(changed, novelai_bridge::ValidationPolicy::Normalize)
            .unwrap(),
        VibeEncodingOutcome::Queued { .. }
    ));
    assert_eq!(store.records.lock().unwrap().len(), 1);
}

fn encoding_input() -> crate::session::VibeEncodingInput {
    crate::session::VibeEncodingInput {
        asset_id: "source".into(),
        model: novelai_bridge::Model::NaiDiffusion45Full,
        information_extracted: 0.6,
        mask_asset_id: None,
        crop_to_mask: None,
        focus_seed: Some(5),
        info_extract_seed: Some(8),
    }
}

fn encoding_draft() -> Draft {
    Draft {
        inputs: crate::session::CreationInputs {
            operation: crate::session::CreationOperation::EncodeVibe(encoding_input()),
            ..Default::default()
        },
        ..Default::default()
    }
}

#[test]
fn concurrent_slot_encoding_requests_share_one_paid_job() {
    let store = Arc::new(MemoryJobs::default());
    let (mut queue, _) = memory_queue(Arc::clone(&store), true);
    Arc::get_mut(&mut queue).unwrap().assets = Arc::new(ImageAssets);
    let barrier = Arc::new(std::sync::Barrier::new(8));
    let ids = std::thread::scope(|scope| {
        let handles: [_; 8] = std::array::from_fn(|_| {
            scope.spawn(|| {
                barrier.wait();
                let outcome = queue
                    .ensure_vibe_encoding(
                        encoding_input(),
                        novelai_bridge::ValidationPolicy::Normalize,
                    )
                    .unwrap();
                let VibeEncodingOutcome::Queued { job } = outcome else {
                    panic!("no completed encoding exists")
                };
                job.id
            })
        });
        handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect::<Vec<_>>()
    });
    assert!(ids.iter().all(|id| id == &ids[0]));
    assert_eq!(store.records.lock().unwrap().len(), 1);
}

#[test]
fn explicit_encoding_submissions_and_retries_remain_distinct_and_are_indexed() {
    let store = Arc::new(MemoryJobs::default());
    let (mut queue, _) = memory_queue(Arc::clone(&store), true);
    Arc::get_mut(&mut queue).unwrap().assets = Arc::new(ImageAssets);
    let first = queue.submit(&encoding_draft()).unwrap().jobs.remove(0);
    let second = queue.submit(&encoding_draft()).unwrap().jobs.remove(0);
    assert_ne!(first.id, second.id);
    let VibeEncodingOutcome::Queued { job } = queue
        .ensure_vibe_encoding(
            encoding_input(),
            novelai_bridge::ValidationPolicy::Normalize,
        )
        .unwrap()
    else {
        panic!("the queued explicit encoding should be reused")
    };
    assert_eq!(job.id, first.id);
    assert_eq!(store.records.lock().unwrap().len(), 2);

    queue.cancel(&first.id).unwrap();
    queue.cancel(&second.id).unwrap();
    let retry = queue.retry(&first.id).unwrap();
    assert_eq!(retry.credential_id, first.credential_id);
    assert_eq!(retry.submission, first.submission);
    assert_eq!(retry.retry_of_job_id.as_deref(), Some(first.id.as_str()));
    let VibeEncodingOutcome::Queued { job } = queue
        .ensure_vibe_encoding(
            encoding_input(),
            novelai_bridge::ValidationPolicy::Normalize,
        )
        .unwrap()
    else {
        panic!("the queued retry should be reused")
    };
    assert_eq!(job.id, retry.id);

    store.records.lock().unwrap().last_mut().unwrap().status = JobStatus::Running;
    let VibeEncodingOutcome::Queued { job } = queue
        .ensure_vibe_encoding(
            encoding_input(),
            novelai_bridge::ValidationPolicy::Normalize,
        )
        .unwrap()
    else {
        panic!("the running retry should be reused")
    };
    assert_eq!(job.id, retry.id);
    assert_eq!(job.status, JobStatus::Running);
}

#[test]
fn unreadable_completed_encoding_does_not_prevent_queue_reuse() {
    let store = Arc::new(MemoryJobs::default());
    let (mut queue, _) = memory_queue(Arc::clone(&store), true);
    Arc::get_mut(&mut queue).unwrap().assets = Arc::new(ImageAssets);
    let original = queue.submit(&encoding_draft()).unwrap().jobs.remove(0);
    let key = queue.encoding_key(&original.submission).unwrap().unwrap();
    store
        .vibes
        .lock()
        .unwrap()
        .push((key, "missing-encoding".into()));
    let VibeEncodingOutcome::Queued { job } = queue
        .ensure_vibe_encoding(
            encoding_input(),
            novelai_bridge::ValidationPolicy::Normalize,
        )
        .unwrap()
    else {
        panic!("unreadable encoding cannot be reused")
    };
    assert_eq!(job.id, original.id);
    assert_eq!(store.records.lock().unwrap().len(), 1);
}

#[test]
fn automatic_batch_seeds_are_resolved_from_one_resource_snapshot() {
    struct CountedResolver {
        reads: Arc<std::sync::atomic::AtomicUsize>,
        resolved: ResolvedDraft,
    }
    impl SubmissionResolver for CountedResolver {
        fn resolve(&self, _draft: &Draft) -> Result<ResolvedDraft, PersistenceError> {
            self.reads.fetch_add(1, Ordering::Relaxed);
            Ok(self.resolved.clone())
        }
    }
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), true);
    let reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut resolved = submission().resolved().unwrap().clone();
    resolved.settings.seed = 0;
    Arc::get_mut(&mut queue).unwrap().resolver = Arc::new(CountedResolver {
        reads: Arc::clone(&reads),
        resolved,
    });
    let mut draft = Draft::default();
    draft.inputs.request_count = 8;
    let batch = queue.submit(&draft).unwrap();
    assert_eq!(reads.load(Ordering::Relaxed), 1);
    assert_eq!(batch.jobs.len(), 8);
    assert!(
        batch
            .jobs
            .iter()
            .all(|job| job.submission.seed().is_some_and(|seed| seed != 0))
    );
}

//! Batch identity, explicit submission and reuse are verified without remote requests.
use super::*;

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
    assert!(matches!(
        queue.submit(&Draft::default()),
        Err(JobError::Bridge(_) | JobError::Invalid(_))
    ));
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
    store
        .vibes
        .lock()
        .unwrap()
        .push((queue.freeze(&draft).unwrap(), "encoding".to_owned()));
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

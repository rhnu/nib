//! Local SDK preparation preserves only effective inputs and immutable media identities.
use super::*;

#[test]
fn source_errors_block_submission_without_changing_saved_source() {
    let mut resolved = submission().resolved().unwrap().clone();
    resolved.fragments[0].text = "cat /* unfinished".to_owned();
    resolved.compile_sources();
    let error = prepare_submission(resolved, &NoAssets).unwrap_err();
    assert!(
        matches!(error, JobError::PromptSource { diagnostics } if diagnostics[0].code == nib_prompt::SourceDiagnosticCode::UnclosedBlockComment)
    );
}

#[test]
fn frozen_native_text_is_not_interpreted_as_editable_source() {
    let mut resolved = submission().resolved().unwrap().clone();
    resolved.positive = "cat /* native literal".to_owned();
    let frozen = prepare_submission(resolved, &NoAssets).unwrap();
    assert_eq!(request(&frozen).core.prompt, "cat /* native literal");
    let reopened = sqlite::decode_submission(&sqlite::encode_submission(&frozen).unwrap()).unwrap();
    assert_eq!(request(&reopened).core.prompt, "cat /* native literal");
}

#[test]
fn director_compiles_comments_without_applying_an_image_model_profile() {
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    Arc::get_mut(&mut queue).unwrap().assets = Arc::new(ImageAssets);
    let mut draft = Draft::default();
    draft.inputs.operation = crate::session::CreationOperation::Director {
        asset_id: "source".to_owned(),
        command: novelai_bridge::DirectorCommand::Emotion {
            prompt: "Text: happy // annotation".to_owned(),
            defry: 2,
        },
    };
    let frozen = queue.freeze(&draft).unwrap();
    assert!(
        matches!(frozen, FrozenSubmission::Director { command: novelai_bridge::DirectorCommand::Emotion { ref prompt, .. }, .. } if prompt == "Text: happy")
    );
    if let crate::session::CreationOperation::Director {
        command: novelai_bridge::DirectorCommand::Emotion { prompt, .. },
        ..
    } = &mut draft.inputs.operation
    {
        *prompt = "happy /* unfinished".to_owned();
    }
    assert!(matches!(
        queue.freeze(&draft),
        Err(JobError::PromptSource { .. })
    ));
}

#[test]
fn director_ignores_unrelated_prompt_dependencies_and_keeps_sdk_adjustments() {
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    Arc::get_mut(&mut queue).unwrap().assets = Arc::new(ImageAssets);
    let mut draft = Draft::default();
    draft.composition.positive.push(PromptNode::Chunk {
        id: "unrelated".to_owned(),
        enabled: true,
        resource_id: ABSENT_ID.to_owned(),
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
fn quote_keeps_effective_inputs_and_leaves_implicit_noise_seed_for_submission() {
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    let state = Arc::get_mut(&mut queue).unwrap();
    state.assets = Arc::new(ImageAssets);
    state.tokenizers = Arc::new(Tokenizers::bundled().unwrap());
    let mut draft = Draft::default();
    draft.composition.positive.push(PromptNode::Text {
        id: "prompt".to_owned(),
        enabled: true,
        text: "a bird".to_owned(),
    });
    draft.settings.seed = Some(123);
    draft.inputs.operation = crate::session::CreationOperation::ImageToImage {
        asset_id: "source".to_owned(),
        strength: 4.0,
        noise: 0.0,
        color_correct: true,
        extra_noise_seed: None,
        add_original_image: true,
        max_enhance: false,
    };
    for stream in [None, Some(novelai_bridge::StreamMode::Sse)] {
        draft.inputs.stream = stream;
        let quote = queue.quote(&draft).unwrap();
        let frozen = queue.freeze(&draft).unwrap();
        let quoted = quote.resolved.unwrap();
        let submitted = frozen.resolved().unwrap();
        assert_eq!(quoted.settings, submitted.settings);
        assert_eq!(quote.diagnostics, frozen.diagnostics());
        assert_eq!(quoted.inputs.stream, submitted.inputs.stream);
        let crate::session::CreationOperation::ImageToImage {
            strength,
            extra_noise_seed,
            ..
        } = quoted.inputs.operation
        else {
            panic!("expected quoted image input")
        };
        assert!(strength < 1.0);
        assert!(extra_noise_seed.is_none());
        assert!(matches!(
            submitted.inputs.operation,
            crate::session::CreationOperation::ImageToImage {
                extra_noise_seed: Some(_),
                ..
            }
        ));
    }
}

#[test]
fn quote_keeps_source_and_input_media_failures() {
    let (queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    let mut draft = Draft::default();
    draft.composition.positive.push(PromptNode::Text {
        id: "source".to_owned(),
        enabled: true,
        text: "cat /* unfinished".to_owned(),
    });
    assert!(matches!(
        queue.quote(&draft),
        Err(JobError::PromptSource { .. })
    ));
    draft.composition.positive.clear();
    draft.inputs.operation = crate::session::CreationOperation::ImageToImage {
        asset_id: "missing".to_owned(),
        strength: 0.5,
        noise: 0.0,
        color_correct: true,
        extra_noise_seed: None,
        add_original_image: true,
        max_enhance: false,
    };
    assert!(matches!(
        queue.quote(&draft),
        Err(JobError::InputMedia { .. })
    ));
}

#[test]
fn quote_keeps_unsupported_stream_delivery_normalized_to_images() {
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    Arc::get_mut(&mut queue).unwrap().tokenizers = Arc::new(Tokenizers::bundled().unwrap());
    let mut draft = Draft::default();
    draft.composition.positive.push(PromptNode::Text {
        id: "prompt".to_owned(),
        enabled: true,
        text: "a bird".to_owned(),
    });
    draft.settings.model = Some(novelai_bridge::Model::NaiDiffusion3);
    draft.inputs.stream = Some(novelai_bridge::StreamMode::Sse);
    let quote = queue.quote(&draft).unwrap();
    assert!(quote.resolved.unwrap().inputs.stream.is_none());
}

#[test]
fn quote_resolved_uses_the_supplied_resource_snapshot_without_rereading() {
    struct CountedResolver(Arc<std::sync::atomic::AtomicUsize>);
    impl SubmissionResolver for CountedResolver {
        fn resolve(&self, _draft: &Draft) -> Result<ResolvedDraft, PersistenceError> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Err(PersistenceError::NotFound {
                kind: "resource",
                id: "removed after resolution".to_owned(),
            })
        }
    }
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    let reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let state = Arc::get_mut(&mut queue).unwrap();
    state.resolver = Arc::new(CountedResolver(Arc::clone(&reads)));
    state.tokenizers = Arc::new(Tokenizers::bundled().unwrap());
    let mut resolved = submission().resolved().unwrap().clone();
    resolved.positive = "snapshot prompt".to_owned();
    resolved.settings.quality = novelai_bridge::QualityPreset::None;
    resolved.inputs.request_count = 3;
    let quote = queue.quote_resolved(resolved).unwrap();
    assert_eq!(reads.load(Ordering::Relaxed), 0);
    assert_eq!(quote.resolved.unwrap().positive, "snapshot prompt");
    assert_eq!(quote.request_count, 3);
    assert_eq!(quote.total_samples, 3);
}

#[test]
fn upscale_quote_ignores_unrelated_prompt_dependencies() {
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    Arc::get_mut(&mut queue).unwrap().assets = Arc::new(ImageAssets);
    let mut draft = Draft::default();
    draft.composition.positive.push(PromptNode::Chunk {
        id: "unrelated".to_owned(),
        enabled: true,
        resource_id: ABSENT_ID.to_owned(),
        override_text: None,
    });
    draft.inputs.operation = crate::session::CreationOperation::Upscale {
        asset_id: "source".to_owned(),
        model: novelai_bridge::Model::default(),
        declared_blur_sigma: novelai_bridge::UpscaleBlurSigma::default(),
    };
    let quote = queue.quote(&draft).unwrap();
    assert_eq!(quote.operation, OperationKind::Upscale);
    assert!(quote.resolved.is_none());
    assert!(quote.tokens.is_empty());
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

#[test]
fn model_restrictions_reject_both_quote_and_submission_before_media_or_credentials() {
    let store = Arc::new(MemoryJobs::default());
    let (mut queue, unexpected_call) = memory_queue(store, false);
    let reader = Resources {
        resource: Resource {
            id: CHUNK_ID.into(),
            name: "Restricted".into(),
            description: String::new(),
            aliases: vec![],
            tags: vec![],
            models: vec![novelai_bridge::Model::NaiDiffusion3.as_str().into()],
            folder_id: None,
            cover_asset_id: None,
            created_at: 0,
            updated_at: 0,
            content: ResourceContent::Chunk {
                text: String::new(),
            },
        },
    };
    let mut draft = Draft::default();
    draft.settings.model = Some(novelai_bridge::Model::NaiDiffusion45Full);
    draft.composition.positive.push(PromptNode::Chunk {
        id: "use".into(),
        enabled: true,
        resource_id: CHUNK_ID.into(),
        override_text: None,
    });
    let resolved = reader.resolve(&draft).unwrap();
    Arc::get_mut(&mut queue).unwrap().resolver = Arc::new(reader);
    assert!(matches!(queue.quote(&draft), Err(JobError::Unresolved)));
    assert!(matches!(
        queue.quote_resolved(resolved.clone()),
        Err(JobError::Unresolved)
    ));
    assert!(matches!(
        prepare_submission(resolved, &NoAssets),
        Err(JobError::Unresolved)
    ));
    assert!(matches!(queue.freeze(&draft), Err(JobError::Unresolved)));
    assert!(!unexpected_call.load(Ordering::Acquire));
}

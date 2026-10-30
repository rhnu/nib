//! Application identities and SDK-effective inputs survive freezing and restoration.

use novelai_bridge::{GenerationInput, InpaintImageToImage, Model, UpscaleBlurSigma};

use super::*;
use crate::session::{CreationOperation, VibeInput, VibeReferenceInput};

#[test]
fn applicable_precise_references_skip_hidden_vibe_media_in_quotes_and_strict_submissions() {
    let (mut queue, unexpected_call) = memory_queue(Arc::new(MemoryJobs::default()), false);
    let queue_mut = Arc::get_mut(&mut queue).unwrap();
    queue_mut.assets = Arc::new(ImageAssets);
    queue_mut.tokenizers = Arc::new(Tokenizers::bundled().unwrap());
    let mut draft = Draft::default();
    draft.settings.model = Some(Model::NaiDiffusion45Full);
    draft.composition.positive.push(PromptNode::Text {
        id: "prompt".into(),
        enabled: true,
        text: "cat".into(),
    });
    draft.inputs.references.precise = vec![crate::session::PreciseReferenceInput {
        id: "precise".into(),
        enabled: true,
        asset_id: "source".into(),
        reference_type: novelai_bridge::CharacterReferenceType::Character,
        strength: 1.0,
        fidelity: 1.0,
        information_extracted: 1.0,
    }];
    draft.inputs.references.vibes = vec![
        VibeReferenceInput {
            id: "missing-encoded".into(),
            enabled: true,
            input: VibeInput::Encoded {
                asset_id: "absent-encoding".into(),
            },
            strength: 1.0,
        },
        VibeReferenceInput {
            id: "missing-image".into(),
            enabled: true,
            input: VibeInput::Image {
                asset_id: "absent-image".into(),
                information_extracted: 1.0,
            },
            strength: 1.0,
        },
    ];
    for policy in [
        novelai_bridge::ValidationPolicy::Normalize,
        novelai_bridge::ValidationPolicy::Reject,
    ] {
        draft.inputs.policy = policy;
        let retained = draft.clone();
        assert!(queue.quote(&draft).unwrap().estimated_anlas.is_some());
        let frozen = queue.freeze(&draft).unwrap();
        assert_eq!(frozen.resolved().unwrap().inputs.references.vibes.len(), 0);
        let hydrated = operations::hydrate(
            request(&frozen).clone(),
            &frozen.resolved().unwrap().inputs,
            &ImageAssets,
        )
        .unwrap();
        let references = hydrated.references.unwrap();
        assert_eq!(references.character_references.len(), 1);
        assert!(references.vibe_transfer.is_none());
        assert_eq!(draft, retained);
    }
    draft.inputs.references.precise[0].enabled = false;
    assert!(matches!(
        queue.quote(&draft),
        Err(JobError::InputMedia { .. })
    ));
    assert!(!unexpected_call.load(Ordering::Acquire));
}

#[test]
fn unsupported_precise_references_do_not_suppress_raw_vibe() {
    let mut inputs = crate::session::CreationInputs::default();
    inputs.references.precise = vec![crate::session::PreciseReferenceInput {
        id: "precise".into(),
        enabled: true,
        asset_id: "source".into(),
        reference_type: novelai_bridge::CharacterReferenceType::Character,
        strength: 1.0,
        fidelity: 1.0,
        information_extracted: 1.0,
    }];
    inputs.references.vibes = vec![VibeReferenceInput {
        id: "vibe".into(),
        enabled: true,
        input: VibeInput::Image {
            asset_id: "source".into(),
            information_extracted: 0.5,
        },
        strength: -0.5,
    }];
    let request =
        novelai_bridge::GenerateImageRequest::builder("cat", Model::NaiDiffusion3).build();
    let normalized = operations::hydrate(request, &inputs, &ImageAssets)
        .unwrap()
        .normalize()
        .unwrap();
    let references = normalized.request().references.as_ref().unwrap();
    assert_eq!(references.character_references.len(), 0);
    assert_eq!(
        references.vibe_transfer.as_ref().unwrap().references.len(),
        1
    );
}

#[test]
fn one_local_quote_reads_each_source_once_for_generation_and_director() {
    struct CountedAssets(Arc<std::sync::atomic::AtomicUsize>);
    impl crate::media::AssetReader for CountedAssets {
        fn image(&self, id: &str) -> Result<novelai_bridge::EncodedImage, PersistenceError> {
            self.0.fetch_add(1, Ordering::Relaxed);
            ImageAssets.image(id)
        }

        fn vibe(&self, id: &str) -> Result<novelai_bridge::VibeEncoding, PersistenceError> {
            ImageAssets.vibe(id)
        }
    }
    let reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (mut queue, unexpected_call) = memory_queue(Arc::new(MemoryJobs::default()), false);
    let queue_mut = Arc::get_mut(&mut queue).unwrap();
    queue_mut.assets = Arc::new(CountedAssets(Arc::clone(&reads)));
    queue_mut.tokenizers = Arc::new(Tokenizers::bundled().unwrap());
    let mut draft = Draft::default();
    draft.composition.positive.push(PromptNode::Text {
        id: "prompt".into(),
        enabled: true,
        text: "a cat".into(),
    });
    draft.inputs.operation = CreationOperation::ImageToImage {
        asset_id: "source".into(),
        strength: 0.7,
        noise: 0.0,
        color_correct: true,
        extra_noise_seed: None,
        add_original_image: false,
        max_enhance: false,
    };
    let quote = queue.quote(&draft).unwrap();
    assert_eq!(reads.load(Ordering::Relaxed), 1);
    assert!(quote.geometry.is_some());
    assert!(quote.estimated_anlas.is_some());
    assert_eq!(quote.tokens.len(), 2);
    draft.inputs.operation = CreationOperation::Director {
        asset_id: "source".into(),
        command: novelai_bridge::DirectorCommand::Lineart,
    };
    let quote = queue.quote(&draft).unwrap();
    assert_eq!(reads.load(Ordering::Relaxed), 2);
    assert!(quote.estimated_anlas.is_some());
    assert!(!unexpected_call.load(Ordering::Acquire));
}

#[test]
fn standalone_vibe_quote_uses_encoder_model_independently_of_generation_model() {
    let (mut queue, unexpected_call) = memory_queue(Arc::new(MemoryJobs::default()), false);
    Arc::get_mut(&mut queue).unwrap().assets = Arc::new(ImageAssets);
    let mut draft = Draft::default();
    draft.settings.model = Some(Model::NaiDiffusion5Full);
    for model in Model::ALL {
        draft.inputs.operation = CreationOperation::EncodeVibe(crate::session::VibeEncodingInput {
            asset_id: "source".to_owned(),
            model,
            information_extracted: 0.7,
            mask_asset_id: None,
            crop_to_mask: None,
            focus_seed: None,
            info_extract_seed: None,
        });
        if !model.descriptor().can_encode_vibe() {
            assert!(matches!(
                queue.quote(&draft),
                Err(JobError::Bridge(
                    novelai_bridge::BridgeError::InvalidRequest(
                        novelai_bridge::InvalidRequest::UnsupportedModelFeature {
                            feature: novelai_bridge::RequestField::EncodeVibe,
                            ..
                        }
                    )
                ))
            ));
            continue;
        }
        let sdk_estimate =
            novelai_bridge::estimate_anlas_cost(novelai_bridge::AnlasEstimateInput {
                model,
                pending_vibe_encodes: 1,
                ..Default::default()
            });
        let quote = queue.quote(&draft).unwrap();
        assert_eq!(quote.operation, OperationKind::EncodeVibe);
        assert_eq!(quote.estimated_anlas, Some(sdk_estimate.vibe_encoding));
        assert!(quote.estimated_anlas.is_some_and(|cost| cost > 0));
        assert!(quote.resolved.is_none());
        assert!(quote.tokens.is_empty());
    }
    assert!(!unexpected_call.load(Ordering::Acquire));
}

#[test]
fn upscale_freezes_only_its_source_and_options_and_reports_unknown_cost() {
    struct LargeImage;
    impl crate::media::AssetReader for LargeImage {
        fn image(&self, _id: &str) -> Result<novelai_bridge::EncodedImage, PersistenceError> {
            novelai_bridge::EncodedImage::from_bytes(include_bytes!("large-source.png").to_vec())
                .map_err(|error| PersistenceError::failure("read synthetic large image", error))
        }

        fn vibe(&self, id: &str) -> Result<novelai_bridge::VibeEncoding, PersistenceError> {
            NoAssets.vibe(id)
        }
    }
    let (mut queue, unexpected_call) = memory_queue(Arc::new(MemoryJobs::default()), false);
    Arc::get_mut(&mut queue).unwrap().assets = Arc::new(LargeImage);
    let mut draft = Draft::default();
    draft.inputs.operation = CreationOperation::Upscale {
        asset_id: "large".to_owned(),
        model: Model::NaiDiffusion5Curated,
        declared_blur_sigma: UpscaleBlurSigma::Sigma035,
    };
    // Non-generation operations must not resolve unrelated prompt resources.
    draft.composition.positive.push(PromptNode::Chunk {
        id: "missing".to_owned(),
        enabled: true,
        resource_id: "absent".to_owned(),
        override_text: None,
    });
    let frozen = queue.freeze(&draft).unwrap();
    assert!(
        matches!(&frozen, FrozenSubmission::Upscale { asset_id, model: Model::NaiDiffusion5Curated, declared_blur_sigma: UpscaleBlurSigma::Sigma035, .. } if asset_id == "large")
    );
    let encoded = sqlite::encode_submission(&frozen).unwrap();
    assert_eq!(sqlite::decode_submission(&encoded).unwrap(), frozen);
    assert!(!encoded.contains("iVBOR"));
    assert!(!encoded.contains("prompt"));
    let quote = queue.quote(&draft).unwrap();
    assert_eq!(quote.operation, OperationKind::Upscale);
    assert_eq!(quote.estimated_anlas, None);
    assert!(!quote.too_expensive);
    assert!(quote.tokens.is_empty());
    assert!(quote.resolved.is_none());
    assert!(!unexpected_call.load(Ordering::Acquire));
}

#[test]
fn curated_inpainting_freezes_quotes_and_restores_the_effective_model() {
    let (mut queue, unexpected_call) = memory_queue(Arc::new(MemoryJobs::default()), false);
    let queue_mut = Arc::get_mut(&mut queue).unwrap();
    queue_mut.assets = Arc::new(ImageAssets);
    queue_mut.tokenizers = Arc::new(Tokenizers::bundled().unwrap());
    let mut resolved = submission().resolved().unwrap().clone();
    resolved.settings.model = Model::NaiDiffusion5Curated;
    resolved.settings.transparent_background = true;
    resolved.inputs.operation = CreationOperation::Inpainting {
        asset_id: "source".into(),
        mask_asset_id: "source".into(),
        img2img: None,
        add_original_image: true,
    };
    let frozen = prepare_submission(resolved.clone(), &ImageAssets).unwrap();
    let reopened = sqlite::decode_submission(&sqlite::encode_submission(&frozen).unwrap()).unwrap();
    let effective_model = Model::NaiDiffusion45Curated;
    assert_eq!(request(&reopened).core.model, effective_model);
    assert_eq!(reopened.resolved().unwrap().settings.model, effective_model);
    assert!(!request(&reopened).core.transparent_background);
    assert!(reopened.diagnostics().iter().any(|diagnostic| {
        diagnostic.field == "core.model" && diagnostic.change.contains(effective_model.as_str())
    }));
    let restored = crate::session::restore_generation(
        request(&reopened),
        reopened.resolved().unwrap().inputs.clone(),
    );
    assert_eq!(restored.settings.model, Some(effective_model));
    assert_eq!(restored.settings.transparent_background, Some(false));
    let quote = queue.quote(&restored).unwrap();
    assert_eq!(quote.resolved.unwrap().settings.model, effective_model);
    assert_eq!(quote.tokens.len(), 2);
    assert!(quote.tokens.iter().all(|usage| usage.limit == 512));
    let restored_submission = queue.freeze(&restored).unwrap();
    assert_eq!(request(&restored_submission).core.model, effective_model);
    assert!(
        !restored_submission
            .diagnostics()
            .iter()
            .any(|diagnostic| diagnostic.field == "core.model")
    );
    resolved.inputs.policy = novelai_bridge::ValidationPolicy::Reject;
    assert!(matches!(
        prepare_submission(resolved, &ImageAssets),
        Err(JobError::Bridge(
            novelai_bridge::BridgeError::InvalidRequest(
                novelai_bridge::InvalidRequest::UnsupportedModelFeature {
                    feature: novelai_bridge::RequestField::Generation(
                        novelai_bridge::GenerationField::Model
                    ),
                    ..
                }
            )
        ))
    ));
    assert!(!unexpected_call.load(Ordering::Acquire));
}

#[test]
fn inpainting_preserves_pure_infill_and_freezes_optional_conditioning_seed() {
    for img2img in [
        None,
        Some(InpaintImageToImage {
            strength: 0.6,
            noise: 0.15,
            color_correct: false,
            extra_noise_seed: None,
        }),
    ] {
        let mut resolved = submission().resolved().unwrap().clone();
        resolved.settings.seed = 789;
        resolved.inputs.operation = CreationOperation::Inpainting {
            asset_id: "source".to_owned(),
            mask_asset_id: "source".to_owned(),
            img2img: img2img.clone(),
            add_original_image: true,
        };
        let frozen = prepare_submission(resolved, &ImageAssets).unwrap();
        let reopened =
            sqlite::decode_submission(&sqlite::encode_submission(&frozen).unwrap()).unwrap();
        let resolved = reopened.resolved().unwrap();
        let draft = crate::session::restore_generation(request(&reopened), resolved.inputs.clone());
        assert_eq!(draft.inputs, resolved.inputs);
        let hydrated =
            operations::hydrate(request(&reopened).clone(), &draft.inputs, &ImageAssets).unwrap();
        let GenerationInput::Inpainting(input) = hydrated.operation else {
            panic!("expected inpainting")
        };
        match (&img2img, input.img2img) {
            (None, None) => {},
            (Some(expected), Some(effective)) => {
                assert_eq!(effective.strength.to_bits(), expected.strength.to_bits());
                assert_eq!(effective.noise.to_bits(), expected.noise.to_bits());
                assert_eq!(effective.color_correct, expected.color_correct);
                assert_eq!(effective.extra_noise_seed, Some(789));
            },
            _ => panic!("freezing changed the conditioning mode"),
        }
    }
}

#[test]
fn raw_v3_vibe_keeps_its_asset_signed_strength_and_extraction() {
    let mut resolved = submission().resolved().unwrap().clone();
    resolved.settings.model = Model::NaiDiffusion3;
    resolved.inputs.references.vibes.push(VibeReferenceInput {
        id: "vibe".to_owned(),
        enabled: true,
        input: VibeInput::Image {
            asset_id: "source".to_owned(),
            information_extracted: 0.4,
        },
        strength: -1.25,
    });
    resolved.inputs.references.normalize_vibe_strength = Some(false);
    let frozen = prepare_submission(resolved, &ImageAssets).unwrap();
    let reopened = sqlite::decode_submission(&sqlite::encode_submission(&frozen).unwrap()).unwrap();
    let inputs = &reopened.resolved().unwrap().inputs;
    assert!(
        matches!(&inputs.references.vibes[0].input, VibeInput::Image { asset_id, .. } if asset_id == "source")
    );
    assert_eq!(
        inputs.references.vibes[0].strength.to_bits(),
        (-1.25_f32).to_bits()
    );
    let hydrated = operations::hydrate(request(&reopened).clone(), inputs, &ImageAssets).unwrap();
    let vibe = hydrated.references.unwrap().vibe_transfer.unwrap();
    assert!(!vibe.normalize_strength);
    assert_eq!(vibe.references[0].strength.to_bits(), (-1.25_f32).to_bits());
    let novelai_bridge::VibeReferenceInput::Image {
        information_extracted,
        ..
    } = &vibe.references[0].input
    else {
        panic!("expected raw image Vibe")
    };
    assert_eq!(information_extracted.to_bits(), 0.4_f32.to_bits());
}

#[test]
fn max_enhance_keeps_its_input_canvas_and_distinct_output_geometry() {
    let mut resolved = submission().resolved().unwrap().clone();
    resolved.settings.size = novelai_bridge::ImageSize {
        width: 512,
        height: 512,
    };
    resolved.inputs.operation = CreationOperation::ImageToImage {
        asset_id: "source".to_owned(),
        strength: 0.5,
        noise: 0.0,
        color_correct: true,
        extra_noise_seed: Some(42),
        add_original_image: true,
        max_enhance: true,
    };
    let frozen = prepare_submission(resolved, &ImageAssets).unwrap();
    let reopened = sqlite::decode_submission(&sqlite::encode_submission(&frozen).unwrap()).unwrap();
    let inputs = &reopened.resolved().unwrap().inputs;
    assert!(matches!(
        inputs.operation,
        CreationOperation::ImageToImage {
            max_enhance: true,
            ..
        }
    ));
    let plan = operations::hydrate(request(&reopened).clone(), inputs, &ImageAssets)
        .unwrap()
        .normalize()
        .unwrap();
    assert_eq!(plan.geometry().input_size, request(&reopened).core.size);
    assert!(plan.geometry().output_size.pixels() > plan.geometry().input_size.pixels());
}

#[test]
fn image_to_image_options_freeze_restore_and_rehydrate_without_following_later_edits() {
    let submitted = submission();
    let mut edited = submitted.resolved().unwrap().clone();
    edited.settings.seed = 789;
    edited.inputs.operation = CreationOperation::ImageToImage {
        asset_id: "source".into(),
        strength: 0.65,
        noise: 0.15,
        color_correct: false,
        extra_noise_seed: None,
        add_original_image: false,
        max_enhance: false,
    };
    let frozen = prepare_submission(edited.clone(), &ImageAssets).unwrap();
    // Subsequent editing must have no effect on the persisted operation or noise seed.
    edited.inputs.operation = CreationOperation::TextToImage;
    edited.settings.seed = 123;
    let encoded = sqlite::encode_submission(&frozen).unwrap();
    let reopened = sqlite::decode_submission(&encoded).unwrap();
    let resolved = reopened.resolved().unwrap();
    let restored = crate::session::restore_generation(request(&reopened), resolved.inputs.clone());
    let hydrated =
        operations::hydrate(request(&reopened).clone(), &restored.inputs, &ImageAssets).unwrap();
    let GenerationInput::ImageToImage(input) = hydrated.operation else {
        panic!("expected restored image-to-image input")
    };
    assert_eq!(input.strength.to_bits(), 0.65_f32.to_bits());
    assert_eq!(input.noise.to_bits(), 0.15_f32.to_bits());
    assert!(!input.color_correct);
    assert!(!input.add_original_image);
    assert!(!input.max_enhance);
    assert_eq!(input.extra_noise_seed, Some(789));
    assert!(matches!(&restored.inputs.operation,
        CreationOperation::ImageToImage { asset_id, .. } if asset_id == "source"));
    assert!(!encoded.contains("iVBOR"));
}

#[test]
fn image_to_image_submission_requires_retained_media_before_it_can_enter_the_queue() {
    let submitted = submission();
    let mut resolved = submitted.resolved().unwrap().clone();
    resolved.inputs.operation = CreationOperation::ImageToImage {
        asset_id: "missing".into(),
        strength: 0.7,
        noise: 0.0,
        color_correct: true,
        extra_noise_seed: None,
        add_original_image: true,
        max_enhance: false,
    };
    assert!(matches!(
        prepare_submission(resolved, &NoAssets),
        Err(JobError::InputMedia { .. })
    ));
}

#[test]
fn precise_references_freeze_signed_parameters_and_restore_the_same_assets() {
    let submitted = submission();
    let mut resolved = submitted.resolved().unwrap().clone();
    resolved.settings.model = Model::NaiDiffusion45Full;
    resolved
        .inputs
        .references
        .precise
        .push(crate::session::PreciseReferenceInput {
            id: "reference".into(),
            enabled: true,
            asset_id: "source".into(),
            reference_type: novelai_bridge::CharacterReferenceType::Costume,
            strength: -2.0,
            fidelity: 1.5,
            information_extracted: 1.5,
        });
    let frozen = prepare_submission(resolved, &ImageAssets).unwrap();
    let encoded = sqlite::encode_submission(&frozen).unwrap();
    let reopened = sqlite::decode_submission(&encoded).unwrap();
    let inputs = reopened.resolved().unwrap().inputs.clone();
    let restored = crate::session::restore_generation(request(&reopened), inputs);
    let hydrated =
        operations::hydrate(request(&reopened).clone(), &restored.inputs, &ImageAssets).unwrap();
    let reference = &hydrated.references.as_ref().unwrap().character_references[0];
    assert_eq!(reference.strength.to_bits(), (-2f32).to_bits());
    assert_eq!(reference.fidelity.to_bits(), 1.5_f32.to_bits());
    assert_eq!(reference.information_extracted.to_bits(), 1f32.to_bits());
    assert_eq!(
        reference.reference_type,
        novelai_bridge::CharacterReferenceType::Costume
    );
    assert_eq!(restored.inputs.references.precise[0].asset_id, "source");
    assert!(!encoded.contains("iVBOR"));
}

#[test]
fn collection_coordinate_modes_freeze_effective_positions_and_restore_without_old_resources() {
    for (mode, expected_x, expected_use_coords) in [
        (None, 0.3_f32, true),
        (Some(false), 0.5_f32, false),
        (Some(true), 0.3_f32, true),
    ] {
        let submitted = submission();
        let mut resolved = submitted.resolved().unwrap().clone();
        resolved.settings.model = Model::NaiDiffusion45Full;
        resolved.settings.use_coords = mode;
        resolved.characters.push(crate::prompt::ResolvedCharacter {
            id: "hero".into(),
            enabled: true,
            positive: "red hair".into(),
            negative: "blue hair".into(),
            position: novelai_bridge::CharacterPosition { x: 0.32, y: 0.68 },
            fragments: Vec::new(),
            preset_instance_id: Some("recipe-use".into()),
            resource_id: Some("recipe".into()),
            expanded: false,
            overridden: true,
        });
        let frozen = prepare_submission(resolved.clone(), &NoAssets).unwrap();
        let reopened =
            sqlite::decode_submission(&sqlite::encode_submission(&frozen).unwrap()).unwrap();
        assert_eq!(
            resolved.characters[0].position.x.to_bits(),
            0.32_f32.to_bits()
        );
        let restored = crate::session::restore_generation(
            request(&reopened),
            reopened.resolved().unwrap().inputs.clone(),
        );
        assert_eq!(
            restored.characters[0].position.x.to_bits(),
            expected_x.to_bits()
        );
        assert_eq!(restored.settings.use_coords, Some(expected_use_coords));
        assert_eq!(restored.characters[0].composition.positive.len(), 1);
        assert_eq!(restored.presets.len(), 0);
    }
}

#[test]
fn precise_reference_indices_skip_disabled_images_and_keep_the_enabled_entry_identity() {
    let submitted = submission();
    let mut resolved = submitted.resolved().unwrap().clone();
    resolved.settings.model = Model::NaiDiffusion45Full;
    let enabled = crate::session::PreciseReferenceInput {
        id: "enabled-reference".into(),
        enabled: true,
        asset_id: "source".into(),
        reference_type: novelai_bridge::CharacterReferenceType::Character,
        strength: 1.0,
        fidelity: 1.0,
        information_extracted: 2.0,
    };
    resolved.inputs.references.precise = vec![
        crate::session::PreciseReferenceInput {
            id: "disabled-reference".into(),
            enabled: false,
            asset_id: "absent-image".into(),
            ..enabled.clone()
        },
        enabled,
    ];
    let frozen = prepare_submission(resolved, &ImageAssets).unwrap();
    let references = &frozen.resolved().unwrap().inputs.references.precise;
    assert_eq!(references.len(), 1);
    assert_eq!(references[0].id, "enabled-reference");
    let sdk_field = novelai_bridge::GenerationField::CharacterReference {
        index: 0,
        field: novelai_bridge::CharacterReferenceField::InformationExtracted,
    }
    .to_string();
    assert!(
        frozen
            .diagnostics()
            .iter()
            .any(|diagnostic| diagnostic.field == sdk_field)
    );
}

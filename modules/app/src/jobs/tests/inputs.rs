//! Application identities and SDK-effective inputs survive freezing and restoration.

use novelai_bridge::{GenerationInput, InpaintImageToImage, Model, UpscaleBlurSigma};

use super::*;
use crate::session::{CreationOperation, VibeInput, VibeReferenceInput};

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

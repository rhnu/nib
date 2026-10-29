//! Local SDK preparation preserves only effective inputs and immutable media identities.
use super::*;

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

use novelai_bridge::{DirectorCommand, GeneratedImageMetadata, ImageMetadata, Model};

use super::*;
use crate::prompt::PromptNode;

#[test]
fn restore_is_independent_and_preserves_sample_seed_without_repeating_sdk_prompt_additions() {
    let submitted = crate::jobs::tests::submission();
    let FrozenSubmission::Generation {
        request, resolved, ..
    } = &submitted
    else {
        panic!("the fixture is a generation submission")
    };
    let restored = restore_submission(&submitted, Some(42));
    assert_eq!(restored.revision, 0);
    assert_eq!(restored.presets.len(), 0);
    assert_eq!(restored.settings.seed, Some(42));
    assert!(
        restored
            .composition
            .positive
            .iter()
            .chain(&restored.composition.negative)
            .all(|node| matches!(node, PromptNode::Text { .. }))
    );
    assert_eq!(restored.settings.model, Some(request.core.model));
    assert_eq!(restored.settings.steps, Some(request.sampling.steps));
    let PromptNode::Text { text, .. } = &restored.composition.positive[0] else {
        panic!("restored prompt is independent text")
    };
    assert_eq!(text, "a cat");
    let repeated = novelai_bridge::GenerateImageRequest::builder(text, request.core.model)
        .negative_prompt(request.core.negative_prompt.clone().unwrap())
        .quality(request.core.quality)
        .uc_preset(request.core.uc_preset)
        .build()
        .normalize()
        .unwrap();
    assert_eq!(repeated.resolved_prompts().prompt, resolved.positive);
    assert_eq!(
        repeated.resolved_prompts().negative_prompt,
        resolved.negative
    );
}

#[test]
fn non_generation_restore_preserves_the_applicable_operation_and_source() {
    let director = FrozenSubmission::Director {
        policy: novelai_bridge::ValidationPolicy::Reject,
        asset_id: "original".into(),
        diagnostics: Vec::new(),
        command: DirectorCommand::Emotion {
            prompt: "happy".into(),
            defry: 2,
        },
    };
    let restored = restore_submission(&director, None);
    assert_eq!(restored.composition.positive.len(), 0);
    assert_eq!(restored.presets.len(), 0);
    assert!(matches!(restored.inputs.operation,
        CreationOperation::Director { asset_id, command: DirectorCommand::Emotion { prompt, defry: 2 } }
        if asset_id == "original" && prompt == "happy"));
    let vibe = FrozenSubmission::EncodeVibe {
        policy: novelai_bridge::ValidationPolicy::Reject,
        asset_id: "source".into(),
        diagnostics: Vec::new(),
        model: Model::default(),
        information_extracted: 0.7,
        mask_asset_id: Some("vibe-mask".into()),
        crop_to_mask: Some(true),
        focus_seed: Some(41),
        info_extract_seed: Some(42),
    };
    let restored = restore_submission(&vibe, None);
    assert!(
        matches!(restored.inputs.operation, CreationOperation::EncodeVibe {
            asset_id, information_extracted, mask_asset_id: Some(mask), crop_to_mask: Some(true),
            focus_seed: Some(41), info_extract_seed: Some(42), ..
        } if asset_id == "source" && mask == "vibe-mask" && information_extracted.to_bits() == 0.7_f32.to_bits())
    );
    let upscale = FrozenSubmission::Upscale {
        asset_id: "upscale-source".into(),
        diagnostics: Vec::new(),
        model: Model::NaiDiffusion5Curated,
        declared_blur_sigma: novelai_bridge::UpscaleBlurSigma::Sigma040,
    };
    assert!(
        matches!(restore_submission(&upscale, None).inputs.operation,
        CreationOperation::Upscale { asset_id, model: Model::NaiDiffusion5Curated,
            declared_blur_sigma: novelai_bridge::UpscaleBlurSigma::Sigma040 }
        if asset_id == "upscale-source")
    );
}

#[test]
fn generation_restore_keeps_source_mask_and_reference_identities() {
    let mut submitted = crate::jobs::tests::submission();
    let FrozenSubmission::Generation { resolved, .. } = &mut submitted else {
        panic!("the fixture is a generation submission")
    };
    resolved.inputs = CreationInputs {
        operation: CreationOperation::Inpainting {
            asset_id: "source".into(),
            mask_asset_id: "mask".into(),
            img2img: Some(novelai_bridge::InpaintImageToImage::new(0.65, 0.1)),
            add_original_image: true,
        },
        references: crate::session::ReferenceInputs {
            vibes: vec![crate::session::VibeReferenceInput {
                id: "reference".into(),
                enabled: true,
                input: crate::session::VibeInput::Encoded {
                    asset_id: "encoding".into(),
                },
                strength: 0.5,
            }],
            normalize_vibe_strength: Some(true),
            ..crate::session::ReferenceInputs::default()
        },
        ..CreationInputs::default()
    };
    let expected_inputs = resolved.inputs.clone();
    let restored = restore_submission(&submitted, Some(7));
    assert_eq!(restored.inputs, expected_inputs);
    assert_eq!(restored.settings.seed, Some(7));
    assert_eq!(restored.presets.len(), 0);
}

#[test]
fn samples_without_seed_metadata_do_not_inherit_the_request_seed() {
    let image = novelai_bridge::EncodedImage::from_base64("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=").unwrap();
    let generated = novelai_bridge::decode_generated_images(image.as_bytes().to_vec())
        .unwrap()
        .remove(0);
    let samples = generation_samples(GenerateImageResult {
        resolved_seed: 123,
        images: vec![generated.clone(), generated],
    })
    .unwrap();
    assert_eq!(samples.len(), 2);
    assert_eq!(samples[0].index, 0);
    assert_eq!(samples[1].index, 1);
    assert!(samples.iter().all(|sample| sample.seed.is_none()));

    let submitted = crate::jobs::tests::submission();
    let restored = restore_submission(&submitted, None);
    assert_eq!(restored.settings.seed, submitted.seed());
}

#[test]
fn metadata_projection_preserves_known_fields_without_copying_embedded_payloads() {
    let mut metadata = ImageMetadata {
        prompt: Some("known prompt".into()),
        width: Some(1024),
        seed: Some(9),
        ..ImageMetadata::default()
    };
    metadata
        .text_chunks
        .insert("private-chunk".into(), vec!["private-payload".into()]);
    let inspection = GeneratedImageMetadata::Parsed(Box::new(metadata));
    let report = metadata::metadata_report(&inspection);
    let known = report.generation.as_ref().unwrap();
    assert_eq!(known.prompt.as_deref(), Some("known prompt"));
    assert_eq!(known.seed, Some(9));
    assert!(known.size.is_none());
    assert!(known.model.is_none());
    let ipc = serde_json::to_string(&report).unwrap();
    assert!(!ipc.contains("private-payload"));
    assert!(!ipc.contains("private-chunk"));
}

#[test]
fn absent_and_invalid_metadata_remain_distinct() {
    let absent = metadata::metadata_report(&GeneratedImageMetadata::NotPresent);
    assert_eq!(absent.status, ImageMetadataStatus::NotPresent);
    assert!(absent.generation.is_none());
    assert_eq!(absent.warnings.len(), 0);
    let invalid = metadata::metadata_report(&GeneratedImageMetadata::Invalid {
        message: "invalid text data".into(),
    });
    assert_eq!(invalid.status, ImageMetadataStatus::Invalid);
    assert!(invalid.generation.is_none());
    assert_eq!(invalid.warnings, vec!["invalid text data"]);
}

#[test]
fn json_response_identity_and_seed_do_not_replace_local_sample_order() {
    let png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=";
    let images =
        novelai_bridge::decode_generated_image_response(novelai_bridge::BufferedResponse {
            status: 200,
            headers: Vec::new(),
            body: serde_json::to_vec(&serde_json::json!({
                "images": [
                    { "image": png, "index": -7, "seed": 11 },
                    { "image": png, "index": 90 }
                ]
            }))
            .unwrap(),
        })
        .unwrap();
    let samples = image_samples(images).unwrap();
    assert_eq!(samples.len(), 2);
    assert_eq!(samples[0].index, 0);
    assert_eq!(samples[1].index, 1);
    assert_eq!(samples[0].seed, Some(11));
    assert_eq!(samples[1].seed, None);
    let source = ResultImageSource::try_from(samples[0].image.source()).unwrap();
    assert_eq!(
        source,
        ResultImageSource::Json {
            position: 0,
            index: Some(-7),
            seed: Some(11)
        }
    );
    let encoded = serde_json::to_string(&source).unwrap();
    assert_eq!(
        serde_json::from_str::<ResultImageSource>(&encoded).unwrap(),
        source
    );
    assert!(image_samples(Vec::new()).is_err());
}

#[test]
fn embedded_vibe_caches_keep_each_model_and_parameter_key() {
    let document = serde_json::json!({
        "identifier": "novelai-vibe-transfer",
        "version": 1,
        "type": "encoding",
        "id": "metadata-reader-does-not-require-document-identity",
        "encodings": {
            "model-a": {
                "parameter-a": { "encoding": "YQ==" },
                "parameter-b": { "encoding": "Yg==" }
            },
            "model-b": { "parameter-a": { "encoding": "Yw==" } }
        }
    });
    let png = novelai_bridge::EncodedImage::from_base64("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=").unwrap();
    let png = novelai_bridge::write_png_text_chunks(
        png.as_bytes(),
        &[novelai_bridge::PngTextEntry::new(
            "naidata",
            document.to_string(),
        )],
    )
    .unwrap();
    let metadata = novelai_bridge::parse_png_metadata_from_bytes(&png).unwrap();
    let encodings = assets::embedded_vibe_encodings("original", &metadata).unwrap();
    assert_eq!(encodings.len(), 3);
    let selected = encodings
        .iter()
        .find(|(_, source)| {
            matches!(source,
        AssetSource::EmbeddedVibe { model: Some(model), parameter_key: Some(key), .. }
        if model == "model-a" && key == "parameter-b")
        })
        .unwrap();
    assert_eq!(selected.0.as_bytes(), b"b");
    assert!(
        matches!(&selected.1, AssetSource::EmbeddedVibe { asset_id, entry_index: 0, .. }
        if asset_id == "original")
    );
}

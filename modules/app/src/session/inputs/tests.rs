use super::*;
use crate::{media::AssetReader, persistence::PersistenceError};

struct ImageAssets;

#[test]
fn separate_encoder_round_trips_zero_seeds_without_switching_generation() {
    let mut input = create_vibe_encoding_input(
        &ImageAssets,
        "retained-source".to_owned(),
        Model::NaiDiffusion45Full,
    )
    .unwrap();
    input.information_extracted = 0.4;
    input.mask_asset_id = Some("mask".to_owned());
    input.crop_to_mask = Some(false);
    input.focus_seed = Some(0);
    input.info_extract_seed = Some(42);
    let draft = crate::session::Draft {
        vibe_encoder: Some(input.clone()),
        ..crate::session::Draft::default()
    };
    crate::session::validate_draft(&draft).unwrap();
    let retained: crate::session::Draft =
        serde_json::from_slice(&serde_json::to_vec(&draft).unwrap()).unwrap();
    assert_eq!(retained.vibe_encoder, Some(input.clone()));
    assert_eq!(retained.inputs.operation, CreationOperation::TextToImage);
    let operation = CreationOperation::EncodeVibe(input);
    let wire = serde_json::to_value(&operation).unwrap();
    assert_eq!(wire["kind"], "encodeVibe");
    assert_eq!(wire["focusSeed"], 0);
    assert_eq!(wire["cropToMask"], false);
    assert_eq!(
        serde_json::from_value::<CreationOperation>(wire).unwrap(),
        operation
    );
}

impl AssetReader for ImageAssets {
    fn image(&self, id: &str) -> Result<novelai_bridge::EncodedImage, PersistenceError> {
        if id != "retained-source" {
            return Err(PersistenceError::NotFound {
                kind: "media asset",
                id: id.to_owned(),
            });
        }
        Ok(novelai_bridge::EncodedImage::from_base64("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=").unwrap())
    }

    fn vibe(&self, _id: &str) -> Result<novelai_bridge::VibeEncoding, PersistenceError> {
        unreachable!("image operation creation only reads image assets")
    }
}

#[test]
fn image_actions_keep_the_source_and_sdk_constructor_defaults() {
    for kind in [
        ImageOperationKind::ImageToImage,
        ImageOperationKind::MaxEnhance,
    ] {
        let operation =
            create_image_operation(&ImageAssets, "retained-source".into(), kind).unwrap();
        let expected = novelai_bridge::ImageToImageInput::new(
            ImageAssets.image("retained-source").unwrap(),
            0.7,
            0.0,
        );
        let CreationOperation::ImageToImage {
            asset_id,
            strength,
            noise,
            color_correct,
            extra_noise_seed,
            add_original_image,
            max_enhance,
        } = operation
        else {
            panic!("expected image-to-image editing state")
        };
        assert_eq!(asset_id, "retained-source");
        assert_eq!(strength.to_bits(), expected.strength.to_bits());
        assert_eq!(noise.to_bits(), expected.noise.to_bits());
        assert_eq!(color_correct, expected.color_correct);
        assert_eq!(extra_noise_seed, expected.extra_noise_seed);
        assert_eq!(add_original_image, expected.add_original_image);
        assert_eq!(max_enhance, matches!(kind, ImageOperationKind::MaxEnhance));
    }
    let expected =
        novelai_bridge::UpscaleImageRequest::new(ImageAssets.image("retained-source").unwrap());
    assert_eq!(
        create_image_operation(
            &ImageAssets,
            "retained-source".into(),
            ImageOperationKind::Upscale
        )
        .unwrap(),
        CreationOperation::Upscale {
            asset_id: "retained-source".into(),
            model: expected.model,
            declared_blur_sigma: expected.declared_blur_sigma,
        }
    );
}

#[test]
fn unavailable_sources_are_rejected_for_every_image_action() {
    for kind in [
        ImageOperationKind::ImageToImage,
        ImageOperationKind::MaxEnhance,
        ImageOperationKind::Upscale,
    ] {
        assert!(matches!(
            create_image_operation(&ImageAssets, "missing".into(), kind),
            Err(PersistenceError::NotFound { .. })
        ));
    }
}

#[test]
fn inpainting_requires_real_source_and_mask_and_uses_pure_infilling_defaults() {
    assert!(matches!(
        create_inpaint_operation(&ImageAssets, "missing".into(), "retained-source".into()),
        Err(PersistenceError::NotFound { .. })
    ));
    assert!(matches!(
        create_inpaint_operation(&ImageAssets, "retained-source".into(), "missing".into()),
        Err(PersistenceError::NotFound { .. })
    ));
    let expected = novelai_bridge::InpaintingInput::new(
        ImageAssets.image("retained-source").unwrap(),
        ImageAssets.image("retained-source").unwrap(),
    );
    assert_eq!(
        create_inpaint_operation(
            &ImageAssets,
            "retained-source".into(),
            "retained-source".into()
        )
        .unwrap(),
        CreationOperation::Inpainting {
            asset_id: "retained-source".into(),
            mask_asset_id: "retained-source".into(),
            img2img: expected.img2img,
            add_original_image: expected.add_original_image,
        }
    );
    let conditioning = image_operation_options().inpaint_conditioning;
    let sdk_defaults = novelai_bridge::InpaintImageToImage::new(0.7, 0.0);
    assert_eq!(conditioning, sdk_defaults);
}

#[test]
fn precise_references_use_real_retained_images_and_sdk_constructor_defaults() {
    assert!(matches!(
        create_precise_reference(
            &ImageAssets,
            "missing".into(),
            "reference".into(),
            CharacterReferenceType::Character
        ),
        Err(PersistenceError::NotFound { .. })
    ));
    let reference = create_precise_reference(
        &ImageAssets,
        "retained-source".into(),
        "reference".into(),
        CharacterReferenceType::Style,
    )
    .unwrap();
    let sdk = novelai_bridge::CharacterReference::new(
        ImageAssets.image("retained-source").unwrap(),
        CharacterReferenceType::Style,
    );
    assert_eq!(reference.id, "reference");
    assert_eq!(reference.asset_id, "retained-source");
    assert!(reference.enabled);
    assert_eq!(reference.reference_type, sdk.reference_type);
    assert_eq!(reference.strength.to_bits(), sdk.strength.to_bits());
    assert_eq!(reference.fidelity.to_bits(), sdk.fidelity.to_bits());
    assert_eq!(
        reference.information_extracted.to_bits(),
        sdk.information_extracted.to_bits()
    );
}

use super::*;
use crate::{media::AssetReader, persistence::PersistenceError};

struct ImageAssets;

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

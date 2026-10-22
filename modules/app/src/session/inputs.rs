//! Recoverable input selections refer to immutable application media, never source paths.

use novelai_bridge::{CharacterReferenceType, DirectorCommand, Model};
use serde::{Deserialize, Serialize};

/// Image actions available from a retained source or result, without modifying a draft.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ImageOperationKind {
    ImageToImage,
    MaxEnhance,
    Upscale,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ImageOperationOptions {
    #[cfg_attr(
        feature = "typegen",
        ts(type = "(0 | 0.3 | 0.35 | 0.4 | 0.45 | 0.5)[]")
    )]
    pub upscale_blur_sigmas: Vec<novelai_bridge::UpscaleBlurSigma>,
}

/// Lists SDK wire values at the IPC boundary; no frontend copy of the enum is required.
#[must_use]
pub fn image_operation_options() -> ImageOperationOptions {
    use novelai_bridge::UpscaleBlurSigma;
    ImageOperationOptions {
        upscale_blur_sigmas: vec![
            UpscaleBlurSigma::None,
            UpscaleBlurSigma::Sigma030,
            UpscaleBlurSigma::Sigma035,
            UpscaleBlurSigma::Sigma040,
            UpscaleBlurSigma::Sigma045,
            UpscaleBlurSigma::Sigma050,
        ],
    }
}

/// Reads a stable application image and projects SDK constructor defaults into editing state.
/// The initial influence and noise are application choices; other defaults belong to the SDK.
///
/// # Errors
/// Returns missing, unavailable or invalid image input without changing the current creation.
pub fn create_image_operation(
    assets: &dyn crate::media::AssetReader,
    id: String,
    kind: ImageOperationKind,
) -> Result<CreationOperation, crate::persistence::PersistenceError> {
    let image = assets.image(&id)?;
    Ok(match kind {
        ImageOperationKind::ImageToImage | ImageOperationKind::MaxEnhance => {
            let input = novelai_bridge::ImageToImageInput::new(image, 0.7, 0.0);
            CreationOperation::ImageToImage {
                asset_id: id,
                strength: input.strength,
                noise: input.noise,
                color_correct: input.color_correct,
                extra_noise_seed: input.extra_noise_seed,
                add_original_image: input.add_original_image,
                max_enhance: matches!(kind, ImageOperationKind::MaxEnhance),
            }
        },
        ImageOperationKind::Upscale => {
            let request = novelai_bridge::UpscaleImageRequest::new(image);
            CreationOperation::Upscale {
                asset_id: id,
                model: request.model,
                declared_blur_sigma: request.declared_blur_sigma,
            }
        },
    })
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct CreationInputs {
    pub operation: CreationOperation,
    #[cfg_attr(feature = "typegen", ts(type = "\"normalize\" | \"reject\""))]
    pub policy: novelai_bridge::ValidationPolicy,
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub stream: Option<novelai_bridge::StreamMode>,
    pub references: ReferenceInputs,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum CreationOperation {
    #[default]
    TextToImage,
    ImageToImage {
        asset_id: String,
        strength: f32,
        noise: f32,
        color_correct: bool,
        #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
        extra_noise_seed: Option<i64>,
        add_original_image: bool,
        max_enhance: bool,
    },
    Inpainting {
        asset_id: String,
        mask_asset_id: String,
        #[cfg_attr(
            feature = "typegen",
            ts(
                type = "{ strength: number; noise: number; color_correct: boolean; extra_noise_seed: number | null } | null"
            )
        )]
        img2img: Option<novelai_bridge::InpaintImageToImage>,
        add_original_image: bool,
    },
    Director {
        asset_id: String,
        #[cfg_attr(
            feature = "typegen",
            ts(
                type = "\"lineart\" | \"sketch\" | \"bg_removal\" | \"declutter\" | \"declutter_keep_bubbles\" | { emotion: { prompt: string; defry: number } } | { colorize: { prompt: string | null; defry: number } }"
            )
        )]
        command: DirectorCommand,
    },
    EncodeVibe {
        asset_id: String,
        #[cfg_attr(feature = "typegen", ts(type = "string"))]
        model: Model,
        information_extracted: f32,
        mask_asset_id: Option<String>,
        crop_to_mask: Option<bool>,
        #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
        focus_seed: Option<i64>,
        #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
        info_extract_seed: Option<i64>,
    },
    Upscale {
        asset_id: String,
        #[cfg_attr(feature = "typegen", ts(type = "string"))]
        model: Model,
        #[cfg_attr(feature = "typegen", ts(type = "0 | 0.3 | 0.35 | 0.4 | 0.45 | 0.5"))]
        declared_blur_sigma: novelai_bridge::UpscaleBlurSigma,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ReferenceInputs {
    pub precise: Vec<PreciseReferenceInput>,
    pub vibes: Vec<VibeReferenceInput>,
    pub normalize_vibe_strength: Option<bool>,
}

impl ReferenceInputs {
    /// Adds recipe outputs in order and overlays their optional strength normalization.
    pub fn append(&mut self, values: &Self) {
        self.precise.extend(values.precise.iter().cloned());
        self.vibes.extend(values.vibes.iter().cloned());
        if values.normalize_vibe_strength.is_some() {
            self.normalize_vibe_strength = values.normalize_vibe_strength;
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PreciseReferenceInput {
    pub id: String,
    pub enabled: bool,
    pub asset_id: String,
    #[cfg_attr(feature = "typegen", ts(type = "string"))]
    pub reference_type: CharacterReferenceType,
    pub strength: f32,
    pub fidelity: f32,
    pub information_extracted: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct VibeReferenceInput {
    pub id: String,
    pub enabled: bool,
    pub input: VibeInput,
    pub strength: f32,
}

/// Application identities select either a V3 source image or an encoded Vibe asset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum VibeInput {
    Encoded {
        asset_id: String,
    },
    Image {
        asset_id: String,
        information_extracted: f32,
    },
}

impl VibeInput {
    pub fn asset_id(&self) -> &str {
        match self {
            Self::Encoded { asset_id } | Self::Image { asset_id, .. } => asset_id,
        }
    }
}

#[cfg(test)]
mod tests;

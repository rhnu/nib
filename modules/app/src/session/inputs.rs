//! Recoverable input selections refer to immutable application media, never source paths.

use novelai_bridge::{CharacterReferenceType, DirectorCommand, Model};
use serde::{Deserialize, Serialize};

use crate::{
    api::UserMessage,
    prompt::{ValidationError, validation::nonempty},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct VibeEncodingOptions {
    #[cfg_attr(feature = "typegen", ts(type = "string[]"))]
    pub models: Vec<Model>,
    pub information_extracted: crate::api::NumericRange,
}

/// Reads supported encoder models from the SDK, independently of the generation model.
#[must_use]
pub fn vibe_encoding_options() -> VibeEncodingOptions {
    VibeEncodingOptions {
        models: Model::ALL
            .into_iter()
            .filter(|model| model.descriptor().can_encode_vibe())
            .collect(),
        // EncodeVibeRequest documents normalized extraction in the unit interval.
        information_extracted: crate::api::NumericRange { min: 0.0, max: 1.0 },
    }
}

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
    #[cfg_attr(
        feature = "typegen",
        ts(
            type = "{ strength: number; noise: number; color_correct: boolean; extra_noise_seed: number | null }"
        )
    )]
    pub inpaint_conditioning: novelai_bridge::InpaintImageToImage,
}

/// Lists SDK wire values at the IPC boundary; no frontend copy of the enum is required.
#[must_use]
pub fn image_operation_options() -> ImageOperationOptions {
    use novelai_bridge::UpscaleBlurSigma;
    ImageOperationOptions {
        inpaint_conditioning: novelai_bridge::InpaintImageToImage::new(0.7, 0.0),
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

/// Creates pure infilling from real retained source and mask assets using SDK defaults.
///
/// # Errors
/// Returns missing, unavailable or invalid source/mask content without editing a draft.
pub fn create_inpaint_operation(
    assets: &dyn crate::media::AssetReader,
    id: String,
    mask_asset_id: String,
) -> Result<CreationOperation, crate::persistence::PersistenceError> {
    let input =
        novelai_bridge::InpaintingInput::new(assets.image(&id)?, assets.image(&mask_asset_id)?);
    Ok(CreationOperation::Inpainting {
        asset_id: id,
        mask_asset_id,
        img2img: input.img2img,
        add_original_image: input.add_original_image,
    })
}

/// Creates a reference entry from retained image bytes and SDK constructor defaults.
/// Identity and enabled state belong to the application; reference semantics belong to the SDK.
///
/// # Errors
/// Returns missing, unavailable or invalid reference image content.
pub fn create_precise_reference(
    assets: &dyn crate::media::AssetReader,
    id: String,
    reference_id: String,
    reference_type: CharacterReferenceType,
) -> Result<PreciseReferenceInput, crate::persistence::PersistenceError> {
    let reference = novelai_bridge::CharacterReference::new(assets.image(&id)?, reference_type);
    Ok(PreciseReferenceInput {
        id: reference_id,
        enabled: true,
        asset_id: id,
        reference_type: reference.reference_type,
        strength: reference.strength,
        fidelity: reference.fidelity,
        information_extracted: reference.information_extracted,
    })
}

/// Initializes the separate encoder form through the SDK constructor.
///
/// # Errors
/// Returns unavailable or invalid source image content.
pub fn create_vibe_encoding_input(
    assets: &dyn crate::media::AssetReader,
    id: String,
    model: Model,
) -> Result<VibeEncodingInput, crate::persistence::PersistenceError> {
    let request = novelai_bridge::EncodeVibeRequest::new(assets.image(&id)?, model);
    Ok(VibeEncodingInput {
        asset_id: id,
        model: request.model,
        information_extracted: request.information_extracted,
        mask_asset_id: None,
        crop_to_mask: request.crop_to_mask,
        focus_seed: request.focus_seed,
        info_extract_seed: request.info_extract_seed,
    })
}

/// Creates a reference from a retained image or encoding, without remote encoding.
/// The initial strength is an application editing choice, not an SDK default.
///
/// # Errors
/// Returns unavailable/incompatible media content.
pub fn create_vibe_reference(
    media: &crate::media::MediaLibrary,
    id: String,
    reference_id: String,
    strength: f32,
) -> Result<VibeReferenceInput, crate::persistence::PersistenceError> {
    use crate::media::AssetReader as _;
    let input = match media.asset(&id)?.kind {
        crate::media::AssetKind::Image => {
            // The SDK deserializer owns the omitted extraction default for image references.
            let value = serde_json::json!({ "kind": "image", "image": media.image(&id)? });
            let reference: novelai_bridge::VibeReferenceInput = serde_json::from_value(value)
                .map_err(|error| {
                    crate::persistence::PersistenceError::failure(
                        "initialize a Vibe image reference",
                        error,
                    )
                })?;
            let novelai_bridge::VibeReferenceInput::Image {
                information_extracted,
                ..
            } = reference
            else {
                unreachable!("the SDK deserialized the supplied image variant")
            };
            VibeInput::Image {
                asset_id: id,
                information_extracted,
            }
        },
        crate::media::AssetKind::Vibe => {
            media.vibe(&id)?;
            VibeInput::Encoded { asset_id: id }
        },
        crate::media::AssetKind::VibeDocument => {
            return Err(crate::persistence::PersistenceError::InvalidData {
                message: UserMessage::VibeContentSelectionRequired,
            });
        },
    };
    Ok(VibeReferenceInput {
        id: reference_id,
        enabled: true,
        input,
        strength,
    })
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct CreationInputs {
    pub request_count: u32,
    pub operation: CreationOperation,
    #[cfg_attr(feature = "typegen", ts(type = "\"normalize\" | \"reject\""))]
    pub policy: novelai_bridge::ValidationPolicy,
    #[cfg_attr(feature = "typegen", ts(type = "\"sse\" | \"msgpack\" | null"))]
    pub stream: Option<novelai_bridge::StreamMode>,
    pub references: ReferenceInputs,
}

impl Default for CreationInputs {
    fn default() -> Self {
        Self {
            request_count: 1,
            operation: CreationOperation::default(),
            policy: novelai_bridge::ValidationPolicy::default(),
            stream: Some(novelai_bridge::StreamMode::Sse),
            references: ReferenceInputs::default(),
        }
    }
}

/// Independently retained Vibe encoder editing inputs, separate from generation references.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct VibeEncodingInput {
    pub asset_id: String,
    #[cfg_attr(feature = "typegen", ts(type = "string"))]
    pub model: Model,
    pub information_extracted: f32,
    pub mask_asset_id: Option<String>,
    pub crop_to_mask: Option<bool>,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub focus_seed: Option<i64>,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub info_extract_seed: Option<i64>,
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
    EncodeVibe(VibeEncodingInput),
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
    /// Resolves retained reference intent before any media is read.
    /// Unsupported precise references must not suppress an otherwise usable Vibe.
    pub(crate) fn resolution(
        &self,
        model: Model,
        mode: novelai_bridge::GenerationMode,
    ) -> novelai_bridge::ReferenceResolution {
        model
            .descriptor()
            .effective_model_for(mode)
            .descriptor()
            .resolve_references(
                mode,
                novelai_bridge::ReferenceIntent {
                    character: self.precise.iter().any(|reference| reference.enabled),
                    vibe: self.vibes.iter().any(|reference| reference.enabled),
                },
            )
    }

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

impl VibeEncodingInput {
    pub(crate) fn validate(&self, field: &str) -> Result<(), ValidationError> {
        nonempty(&self.asset_id, &format!("{field}.assetId"))?;
        if let Some(id) = &self.mask_asset_id {
            nonempty(id, &format!("{field}.maskAssetId"))?;
        }
        Ok(())
    }
}

impl CreationOperation {
    pub(crate) fn validate(&self) -> Result<(), ValidationError> {
        match self {
            Self::TextToImage => {},
            Self::ImageToImage { asset_id, .. }
            | Self::Upscale { asset_id, .. }
            | Self::Director { asset_id, .. } => {
                nonempty(asset_id, "inputs.operation.assetId")?;
            },
            Self::EncodeVibe(input) => input.validate("inputs.operation")?,
            Self::Inpainting {
                asset_id,
                mask_asset_id,
                ..
            } => {
                nonempty(asset_id, "inputs.operation.assetId")?;
                nonempty(mask_asset_id, "inputs.operation.maskAssetId")?;
            },
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;

//! IPC views read SDK descriptors; they never decide request validity.

use novelai_bridge::{
    GenerationMode, QualityPreset, ReferenceAvailability, ReferenceIntent, Sampler, UcPreset,
};
use serde::Serialize;

use crate::{prompt::ResolvedDraft, session::CreationOperation};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
#[expect(
    clippy::struct_excessive_bools,
    reason = "IPC projects independent SDK capability switches"
)]
pub struct ModelCapabilities {
    pub model: String,
    pub tokenizer: String,
    pub token_limit: u32,
    pub max_characters: u32,
    pub character_positioning: Option<String>,
    pub streaming: bool,
    pub inpainting: bool,
    pub inpainting_image_to_image: bool,
    pub max_enhance: bool,
    pub encode_vibe: bool,
    pub vibe_input_path: Option<String>,
    pub custom_negative_prompts: bool,
    pub legacy_uc: bool,
    #[cfg_attr(feature = "typegen", ts(type = "string[]"))]
    pub quality_presets: Vec<QualityPreset>,
    #[cfg_attr(feature = "typegen", ts(type = "string[]"))]
    pub uc_presets: Vec<UcPreset>,
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub fixed_sampler: Option<Sampler>,
    pub transparent_background: bool,
    pub furry_mode: bool,
    pub smea: bool,
    pub decrisp: bool,
    pub variety_boost: bool,
    pub can_add_precise_reference: bool,
    pub can_add_vibe_reference: bool,
    pub precise_reference: ReferenceStatus,
    pub vibe_reference: ReferenceStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ReferenceStatus {
    pub available: bool,
    pub reason: String,
}

impl From<ReferenceAvailability> for ReferenceStatus {
    fn from(value: ReferenceAvailability) -> Self {
        Self {
            available: value.is_available(),
            reason: match value {
                ReferenceAvailability::Available => "available",
                ReferenceAvailability::NotRequested => "notRequested",
                ReferenceAvailability::Unsupported => "unsupported",
                ReferenceAvailability::UnsupportedMode => "unsupportedMode",
                ReferenceAvailability::ConflictWithCharacterReference => {
                    "conflictWithPreciseReference"
                },
                _ => "unavailable",
            }
            .to_owned(),
        }
    }
}

/// Projects capabilities for the resolved model and actual input intent.
pub fn model_capabilities(resolved: &ResolvedDraft) -> Option<ModelCapabilities> {
    let model = resolved.settings.model;
    let descriptor = model.descriptor();
    let mode = match resolved.inputs.operation {
        CreationOperation::ImageToImage { .. } => GenerationMode::ImageToImage,
        CreationOperation::Inpainting { .. } => GenerationMode::Inpainting,
        CreationOperation::TextToImage => GenerationMode::TextToImage,
        CreationOperation::Director { .. }
        | CreationOperation::EncodeVibe { .. }
        | CreationOperation::Upscale { .. } => return None,
    };
    let references = descriptor.resolve_references(
        mode,
        ReferenceIntent {
            vibe: resolved
                .inputs
                .references
                .vibes
                .iter()
                .any(|reference| reference.enabled),
            character: resolved
                .inputs
                .references
                .precise
                .iter()
                .any(|reference| reference.enabled),
        },
    );
    Some(ModelCapabilities {
        model: model.as_str().to_owned(),
        tokenizer: descriptor.prompt().tokenizer.as_str().to_owned(),
        token_limit: descriptor.prompt().token_limit,
        max_characters: descriptor.prompt().max_characters(),
        character_positioning: descriptor.prompt().characters.map(|profile| {
            match profile.positioning {
                novelai_bridge::CharacterPositionProfile::Grid5x5 => "grid5x5",
                novelai_bridge::CharacterPositionProfile::Freeform => "freeform",
                _ => "unknown",
            }
            .to_owned()
        }),
        streaming: descriptor.support().streaming,
        inpainting: descriptor.support().inpainting.is_some(),
        inpainting_image_to_image: descriptor
            .support()
            .inpainting
            .is_some_and(|profile| profile.image_to_image),
        max_enhance: descriptor.support().max_enhance,
        encode_vibe: descriptor.can_encode_vibe(),
        vibe_input_path: descriptor.support().vibe.map(|profile| {
            match profile.input {
                novelai_bridge::VibeInputPath::RawImage => "image",
                novelai_bridge::VibeInputPath::Encoded => "encoded",
                _ => "unknown",
            }
            .to_owned()
        }),
        custom_negative_prompts: descriptor.prompt().custom_negative_prompts,
        legacy_uc: descriptor.prompt().legacy_uc,
        quality_presets: descriptor
            .prompt()
            .quality_presets
            .iter()
            .map(|definition| definition.preset)
            .collect(),
        uc_presets: descriptor
            .prompt()
            .uc_presets
            .iter()
            .map(|definition| definition.preset)
            .collect(),
        fixed_sampler: descriptor.sampling().fixed_sampler,
        transparent_background: descriptor.prompt().transparent_background,
        furry_mode: descriptor.prompt().furry_mode,
        smea: descriptor.sampling().smea,
        decrisp: descriptor.sampling().dynamic_thresholding,
        variety_boost: descriptor.sampling().variety.is_some(),
        can_add_precise_reference: descriptor
            .resolve_references(
                mode,
                ReferenceIntent {
                    character: true,
                    vibe: false,
                },
            )
            .character
            .is_available(),
        can_add_vibe_reference: descriptor
            .resolve_references(
                mode,
                ReferenceIntent {
                    character: false,
                    vibe: true,
                },
            )
            .vibe
            .is_available(),
        precise_reference: references.character.into(),
        vibe_reference: references.vibe.into(),
    })
}

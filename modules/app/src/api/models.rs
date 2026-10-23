//! IPC views read SDK descriptors; they never decide request validity.

use novelai_bridge::{
    AlphaMode, CharacterPosition, CharacterPositionProfile, CharacterReferenceType, CharacterSet,
    GenerationMode, ImageFormat, ImageResponseFormat, Model, NoiseSchedule, QualityPreset,
    ReferenceAvailability, ReferenceIntent, Sampler, UcPreset,
};
use serde::Serialize;

use crate::{
    prompt::{GenerationSettings, ResolvedDraft, ResolvedSettings},
    session::CreationOperation,
};

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
    pub character_position_options: CharacterPositionOptions,
    pub precise_reference_options: PreciseReferenceOptions,
    pub vibe_reference_options: VibeReferenceOptions,
    pub streaming: bool,
    #[cfg_attr(feature = "typegen", ts(type = "(\"sse\" | \"msgpack\")[]"))]
    pub stream_modes: Vec<novelai_bridge::StreamMode>,
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
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub fixed_noise_schedule: Option<NoiseSchedule>,
    #[cfg_attr(feature = "typegen", ts(type = "string[]"))]
    pub samplers: Vec<Sampler>,
    #[cfg_attr(feature = "typegen", ts(type = "string[]"))]
    pub noise_schedules: Vec<NoiseSchedule>,
    #[cfg_attr(feature = "typegen", ts(type = "string[]"))]
    pub image_formats: Vec<ImageFormat>,
    #[cfg_attr(feature = "typegen", ts(type = "(\"straight\" | \"premultiplied\")[]"))]
    pub alpha_modes: Vec<AlphaMode>,
    #[cfg_attr(feature = "typegen", ts(type = "(\"zip\" | \"json\")[]"))]
    pub response_formats: Vec<ImageResponseFormat>,
    pub defaults: ResolvedSettings,
    pub ranges: GenerationRanges,
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

/// Numeric editor hints copied from SDK descriptors; validation stays in the SDK.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct GenerationRanges {
    pub dimension: NumericRange,
    pub dimension_multiple: u32,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub max_pixels: u64,
    pub steps: NumericRange,
    pub scale: NumericRange,
    pub n_samples: NumericRange,
    pub cfg_rescale: NumericRange,
    pub img2img_strength: NumericRange,
    pub img2img_noise: NumericRange,
    pub inpaint_strength: NumericRange,
}

#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct NumericRange {
    pub min: f64,
    pub max: f64,
}

/// SDK coordinate defaults and editor hints; normalization remains in the SDK.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct CharacterPositionOptions {
    #[cfg_attr(feature = "typegen", ts(type = "{ x: number; y: number }"))]
    pub default_position: CharacterPosition,
    pub range: NumericRange,
    pub grid_coordinates: Option<Vec<f32>>,
    pub use_coords_default: Option<bool>,
}

/// A missing numeric bound means the SDK accepts finite signed values, not a unit interval.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PreciseReferenceOptions {
    #[cfg_attr(feature = "typegen", ts(type = "string[]"))]
    pub reference_types: Vec<CharacterReferenceType>,
    pub strength: Option<NumericRange>,
    pub fidelity: Option<NumericRange>,
    pub information_extracted: NumericRange,
    pub max_references: Option<u32>,
}

/// SDK Vibe editor hints; an absent strength bound means finite signed values.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct VibeReferenceOptions {
    pub strength: Option<NumericRange>,
    pub information_extracted: NumericRange,
    pub normalize_strength_default: bool,
    pub metadata_model_key: Option<String>,
}

impl<T: Into<f64>> From<novelai_bridge::ParameterRange<T>> for NumericRange {
    fn from(value: novelai_bridge::ParameterRange<T>) -> Self {
        Self {
            min: value.min.into(),
            max: value.max.into(),
        }
    }
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
    let mode = match resolved.inputs.operation {
        CreationOperation::ImageToImage { .. } => GenerationMode::ImageToImage,
        CreationOperation::Inpainting { .. } => GenerationMode::Inpainting,
        CreationOperation::TextToImage => GenerationMode::TextToImage,
        CreationOperation::Director { .. }
        | CreationOperation::EncodeVibe(crate::session::VibeEncodingInput { .. })
        | CreationOperation::Upscale { .. } => return None,
    };
    Some(project_capabilities(
        &resolved.settings,
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
    ))
}

/// Returns standalone text-to-image editor hints without reading a creation or resources.
#[must_use]
pub fn model_defaults_capabilities(
    model: Model,
    settings: Option<GenerationSettings>,
) -> ModelCapabilities {
    let settings = GenerationSettings {
        model: Some(model),
        ..settings.unwrap_or_default()
    }
    .resolve();
    project_capabilities(
        &settings,
        GenerationMode::TextToImage,
        ReferenceIntent::default(),
    )
}

fn project_capabilities(
    settings: &ResolvedSettings,
    mode: GenerationMode,
    intent: ReferenceIntent,
) -> ModelCapabilities {
    let model = settings.model.descriptor().effective_model_for(mode);
    let settings = ResolvedSettings {
        model,
        ..settings.clone()
    };
    let descriptor = model.descriptor();
    let references = descriptor.resolve_references(mode, intent);
    let profile = descriptor.sampling();
    let (sampler, samplers, noise_schedules) = sampling_options(&settings, mode);
    ModelCapabilities {
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
        character_position_options: character_position_options(
            descriptor
                .prompt()
                .characters
                .map(|profile| profile.positioning),
        ),
        precise_reference_options: precise_reference_options(),
        vibe_reference_options: vibe_reference_options(model),
        streaming: descriptor.support().streaming,
        stream_modes: stream_modes(descriptor.support().streaming),
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
        fixed_noise_schedule: (noise_schedules.len() == 1).then(|| noise_schedules[0]),
        samplers,
        noise_schedules,
        image_formats: vec![ImageFormat::Png, ImageFormat::Webp],
        alpha_modes: vec![AlphaMode::Straight, AlphaMode::Premultiplied],
        response_formats: vec![ImageResponseFormat::Zip, ImageResponseFormat::Json],
        defaults: ResolvedSettings::from_request(
            &novelai_bridge::GenerateImageRequest::builder("", model).build(),
        ),
        ranges: generation_ranges(&settings),
        transparent_background: descriptor.prompt().transparent_background,
        furry_mode: descriptor.prompt().furry_mode,
        smea: profile.supports_smea(mode, sampler),
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
    }
}

fn stream_modes(supported: bool) -> Vec<novelai_bridge::StreamMode> {
    if supported {
        vec![
            novelai_bridge::StreamMode::Sse,
            novelai_bridge::StreamMode::MessagePack,
        ]
    } else {
        Vec::new()
    }
}

fn character_position_options(
    profile: Option<CharacterPositionProfile>,
) -> CharacterPositionOptions {
    CharacterPositionOptions {
        default_position: CharacterPosition::default(),
        // CharacterPosition documents normalized coordinates; the SDK owns clamping/snapping.
        range: NumericRange { min: 0.0, max: 1.0 },
        grid_coordinates: profile.and_then(|profile| match profile {
            CharacterPositionProfile::Grid5x5 => Some(
                (0..5_u8)
                    .map(|index| profile.resolve_coordinate(f32::from(index) / 4.0))
                    .collect(),
            ),
            _ => None,
        }),
        use_coords_default: CharacterSet::default().use_coords,
    }
}

fn vibe_reference_options(model: Model) -> VibeReferenceOptions {
    VibeReferenceOptions {
        strength: None,
        // SDK VibeReference and EncodeVibeRequest document extraction in 0..1.
        information_extracted: NumericRange { min: 0.0, max: 1.0 },
        normalize_strength_default: novelai_bridge::VibeTransferConfig::new(Vec::new())
            .normalize_strength,
        metadata_model_key: model.vibe_model_key().map(str::to_owned),
    }
}

fn precise_reference_options() -> PreciseReferenceOptions {
    PreciseReferenceOptions {
        reference_types: vec![
            CharacterReferenceType::Character,
            CharacterReferenceType::Style,
            CharacterReferenceType::CharacterAndStyle,
            CharacterReferenceType::Costume,
            CharacterReferenceType::Delta,
        ],
        strength: None,
        fidelity: None,
        // CharacterReference documents extraction in 0..1, but exposes no range descriptor.
        // Strength/fidelity are finite signed values and the SDK declares no count limit.
        information_extracted: NumericRange { min: 0.0, max: 1.0 },
        max_references: None,
    }
}

fn generation_ranges(settings: &ResolvedSettings) -> GenerationRanges {
    let descriptor = settings.model.descriptor();
    let constraints = descriptor.constraints();
    GenerationRanges {
        dimension: constraints.canvas.dimension.into(),
        dimension_multiple: constraints.canvas.multiple,
        max_pixels: constraints.canvas.max_pixels,
        steps: constraints.steps.into(),
        scale: constraints.scale.into(),
        n_samples: NumericRange {
            min: f64::from(constraints.samples.min),
            max: f64::from(descriptor.sample_limit(settings.size)),
        },
        cfg_rescale: constraints.cfg_rescale.into(),
        img2img_strength: constraints.img2img_strength.into(),
        img2img_noise: constraints.img2img_noise.into(),
        inpaint_strength: constraints.inpaint_strength.into(),
    }
}

/// Enumerates presentation choices through SDK sampling resolution for this context.
fn sampling_options(
    settings: &ResolvedSettings,
    mode: GenerationMode,
) -> (Sampler, Vec<Sampler>, Vec<NoiseSchedule>) {
    let steps = settings.steps;
    let profile = settings.model.descriptor().sampling();
    let sampler = profile.resolve_sampler_for_steps(mode, settings.sampler, steps);
    let samplers = [
        Sampler::KEuler,
        Sampler::KEulerAncestral,
        Sampler::KDpm2,
        Sampler::KDpm2Ancestral,
        Sampler::KDpmpp2m,
        Sampler::KDpmpp2mSde,
        Sampler::KDpmpp2sAncestral,
        Sampler::KDpmppSde,
        Sampler::Ddim,
        Sampler::DdimV3,
    ]
    .into_iter()
    .filter(|value| profile.resolve_sampler_for_steps(mode, *value, steps) == *value)
    .collect();
    let noise_schedules: Vec<_> = [
        NoiseSchedule::Native,
        NoiseSchedule::Karras,
        NoiseSchedule::Exponential,
        NoiseSchedule::Polyexponential,
    ]
    .into_iter()
    .filter(|value| {
        profile
            .resolve_noise_schedule_for(sampler, *value)
            .unwrap_or(NoiseSchedule::Native)
            == *value
    })
    .collect();
    (sampler, samplers, noise_schedules)
}

#[cfg(test)]
mod tests;

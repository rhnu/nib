use novelai_bridge::{CharacterMetadata, ImageMetadata};
use serde_json::Value;

use super::{
    ExploreError, ExploreErrorKind, ExploreMetadata, ExploreMetadataStatus, ExploreParameter,
};
use crate::{api::UserMessage, media::MetadataRestore, session::Draft};

const MAX_METADATA: usize = 256 * 1024;

/// Adapts recognized application fields from the website's bounded JSON text envelope.
pub(super) fn interpret(raw: Option<&Value>) -> (ExploreMetadata, Option<ImageMetadata>) {
    let mut view = ExploreMetadata {
        status: ExploreMetadataStatus::Missing,
        prompt: None,
        negative_prompt: None,
        characters: vec![],
        negative_characters: vec![],
        parameters: vec![],
        warnings: vec![],
        raw: None,
    };
    let Some(value) = raw.filter(|value| !value.is_null()) else {
        return (view, None);
    };
    let Some(text) = value.as_str() else {
        view.status = ExploreMetadataStatus::Invalid;
        view.warnings
            .push("Website metadata is not JSON text".into());
        return (view, None);
    };
    if text.trim().is_empty() {
        return (view, None);
    }
    if text.len() > MAX_METADATA {
        view.status = ExploreMetadataStatus::Invalid;
        view.warnings
            .push("Website metadata exceeds the size budget".into());
        return (view, None);
    }
    view.raw = Some(text.into());
    let Ok(Value::Object(envelope)) = serde_json::from_str::<Value>(text) else {
        view.status = ExploreMetadataStatus::Invalid;
        view.warnings
            .push("Website metadata is not a JSON object".into());
        return (view, None);
    };
    let comment = decode_comment(&envelope, &mut view.warnings);
    let mut parsed = adapt_metadata(&envelope, comment.as_ref(), &mut view.warnings);
    validate_numbers(comment.as_ref(), &mut view.warnings);
    parsed.raw_comment_json = comment;
    project(&mut view, &parsed);
    (view, Some(parsed))
}

fn decode_comment(
    envelope: &serde_json::Map<String, Value>,
    warnings: &mut Vec<String>,
) -> Option<Value> {
    match envelope.get("Comment") {
        Some(Value::String(text)) => {
            if let Ok(Value::Object(object)) = serde_json::from_str::<Value>(text) {
                Some(Value::Object(object))
            } else {
                warnings.push("Comment metadata could not be decoded".into());
                None
            }
        },
        Some(Value::Object(object)) => Some(Value::Object(object.clone())),
        None => None,
        _ => {
            warnings.push("Comment metadata is not an object".into());
            None
        },
    }
}

fn adapt_metadata(
    envelope: &serde_json::Map<String, Value>,
    comment: Option<&Value>,
    warnings: &mut Vec<String>,
) -> ImageMetadata {
    let text = |name: &str| {
        comment
            .and_then(|comment| comment.get(name))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    let nested_text = |pointer: &str| {
        comment
            .and_then(|comment| comment.pointer(pointer))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    let number = |name: &str| comment.and_then(|comment| comment.get(name));
    let u32_field = |name: &str| {
        number(name)
            .and_then(Value::as_u64)
            .and_then(|number| u32::try_from(number).ok())
    };
    let f32_field = |name: &str| {
        number(name)
            .and_then(|value| serde_json::from_value::<f32>(value.clone()).ok())
            .filter(|number| number.is_finite())
    };
    let positive = character_texts(comment, "v4_prompt", warnings);
    let negative = character_texts(comment, "v4_negative_prompt", warnings);
    ImageMetadata {
        prompt: nested_text("/v4_prompt/caption/base_caption")
            .or_else(|| text("prompt"))
            .or_else(|| {
                envelope
                    .get("Description")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            }),
        negative_prompt: nested_text("/v4_negative_prompt/caption/base_caption")
            .or_else(|| text("uc"))
            .or_else(|| text("negative_prompt")),
        model: text("model").or_else(|| text("model_name")),
        seed: number("seed").and_then(Value::as_i64),
        steps: u32_field("steps"),
        width: u32_field("width"),
        height: u32_field("height"),
        scale: f32_field("scale"),
        cfg_rescale: f32_field("cfg_rescale"),
        sampler: text("sampler"),
        noise_schedule: text("noise_schedule"),
        uc_preset: number("uc_preset")
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok()),
        quality_toggle: number("qualityToggle")
            .or_else(|| number("quality_toggle"))
            .and_then(Value::as_bool),
        source: envelope
            .get("Source")
            .and_then(Value::as_str)
            .map(str::to_owned),
        characters: (0..positive.len().max(negative.len()))
            .map(|index| CharacterMetadata {
                source_index: index,
                prompt: positive.get(index).cloned().flatten(),
                negative_prompt: negative.get(index).cloned().flatten(),
            })
            .collect(),
        ..ImageMetadata::default()
    }
}

fn validate_numbers(comment: Option<&Value>, warnings: &mut Vec<String>) {
    for name in ["seed", "steps", "width", "height", "scale", "cfg_rescale"] {
        if let Some(value) = comment.and_then(|comment| comment.get(name)) {
            let valid = match name {
                "seed" => value.as_i64().is_some(),
                "scale" | "cfg_rescale" => {
                    serde_json::from_value::<f32>(value.clone()).is_ok_and(f32::is_finite)
                },
                _ => value
                    .as_u64()
                    .is_some_and(|value| u32::try_from(value).is_ok()),
            };
            if !valid {
                warnings.push(format!("Invalid numeric metadata field: {name}"));
            }
        }
    }
}

fn project(view: &mut ExploreMetadata, parsed: &ImageMetadata) {
    view.prompt.clone_from(&parsed.prompt);
    view.negative_prompt.clone_from(&parsed.negative_prompt);
    // Missing character entries remain in their original positions in the SDK projection.
    view.characters = parsed
        .characters
        .iter()
        .map(|item| item.prompt.clone().unwrap_or_default())
        .collect();
    view.negative_characters = parsed
        .characters
        .iter()
        .map(|item| item.negative_prompt.clone().unwrap_or_default())
        .collect();
    if let Some(comment) = &parsed.raw_comment_json {
        for name in [
            "model",
            "model_name",
            "seed",
            "steps",
            "sampler",
            "width",
            "height",
            "scale",
            "noise_schedule",
            "cfg_rescale",
            "qualityToggle",
            "sm",
            "sm_dyn",
        ] {
            if let Some(value) = comment
                .get(name)
                .filter(|value| value.is_string() || value.is_number() || value.is_boolean())
            {
                view.parameters.push(ExploreParameter {
                    name: name.into(),
                    value: value
                        .as_str()
                        .map_or_else(|| value.to_string(), str::to_owned),
                });
            }
        }
    }
    if view
        .parameters
        .iter()
        .all(|entry| entry.name != "model" && entry.name != "model_name")
    {
        if let Some(model) = &parsed.model {
            view.parameters.push(ExploreParameter {
                name: "model".into(),
                value: model.clone(),
            });
        } else if let Some(source) = &parsed.source {
            view.parameters.push(ExploreParameter {
                name: "source".into(),
                value: source.clone(),
            });
        }
    }
    if parsed.has_generation_data() && parsed.model.is_none() {
        view.warnings
            .push("Generation model is absent; only prompt text can be copied".into());
    }
    view.status = if !view.warnings.is_empty() {
        ExploreMetadataStatus::Partial
    } else if parsed.has_generation_data() {
        ExploreMetadataStatus::Available
    } else {
        ExploreMetadataStatus::Missing
    };
}

fn character_texts(
    comment: Option<&Value>,
    name: &str,
    warnings: &mut Vec<String>,
) -> Vec<Option<String>> {
    let Some(raw) = comment
        .and_then(|comment| comment.get(name))
        .and_then(|value| value.pointer("/caption/char_captions"))
    else {
        return vec![];
    };
    let Some(items) = raw.as_array() else {
        warnings.push("Character captions are not an array".into());
        return vec![];
    };
    if items.len() > 64 {
        warnings.push("Character captions are truncated to 64 entries".into());
    }
    items
        .iter()
        .take(64)
        .map(|item| {
            let text = item
                .get("char_caption")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if text.is_none() {
                warnings.push("A character caption has no text".into());
            }
            text
        })
        .collect()
}

/// Restores only recognized metadata through the same conversion used by imported images.
pub(super) fn restore(
    raw: Option<&Value>,
    current: Draft,
) -> Result<MetadataRestore, ExploreError> {
    let (view, parsed) = interpret(raw);
    let parsed = parsed
        .filter(ImageMetadata::has_generation_data)
        .ok_or_else(|| {
            ExploreError::new(
                ExploreErrorKind::InvalidResponse,
                "No usable generation metadata",
            )
        })?;
    let mut draft = crate::session::draft_from_metadata(&parsed);
    if draft.settings.model.is_none() {
        return Err(ExploreError::new(
            ExploreErrorKind::InvalidResponse,
            "The generation model is missing or unsupported; copy prompt text instead",
        ));
    }
    let mut notices = vec![
        UserMessage::RestoreKnownFieldsOnly,
        UserMessage::RestoreLiteralPrompts,
    ];
    if !parsed.characters.is_empty() {
        notices.push(UserMessage::RestoreCharactersUnavailable);
    }
    // Explore metadata contains neither source-image bytes nor masks/reference identities.
    notices.push(UserMessage::external("Source images, masks and reference materials are unavailable; image creation is restored as text to image"));
    if !view.warnings.is_empty() {
        notices.push(UserMessage::RestoreUnknownFields);
    }
    if parsed.sampler.is_some() && draft.settings.sampler.is_none() {
        notices.push(UserMessage::RestoreSamplerUnknown);
    }
    if parsed.noise_schedule.is_some() && draft.settings.noise_schedule.is_none() {
        notices.push(UserMessage::RestoreNoiseScheduleUnknown);
    }
    if parsed.uc_preset.is_some() && parsed.negative_prompt.is_none() {
        notices.push(UserMessage::RestoreLegacyUcUnknown);
    }
    draft.mask_editor = current.mask_editor;
    draft.vibe_encoder = current.vibe_encoder;
    draft.director = current.director;
    draft.png_text_editor = current.png_text_editor;
    draft.active_page = crate::session::ActivePage::Create;
    Ok(MetadataRestore { draft, notices })
}

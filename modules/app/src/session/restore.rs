//! Standalone restoration uses effective SDK input without resource dependencies.

use novelai_bridge::{GenerateImageRequest, ImageMetadata, ImageSize, QualityPreset, UcPreset};

use super::{CreationInputs, Draft};
use crate::prompt::{
    CharacterComposition, Composition, GenerationSettings, PromptNode, ResolvedSettings,
};

fn text(id: &str, text: String) -> PromptNode {
    PromptNode::Text {
        id: id.into(),
        enabled: true,
        text,
    }
}

fn composition(id: &str, positive: String, negative: String) -> Composition {
    Composition {
        positive: vec![text(&format!("{id}-positive"), positive)],
        negative: vec![text(&format!("{id}-negative"), negative)],
    }
}

/// Restores raw normalized prompt fields with their effective automatic prompt settings.
/// Media selections must refer to the same immutable assets used by the frozen request.
#[must_use]
pub fn restore_generation(request: &GenerateImageRequest, inputs: CreationInputs) -> Draft {
    Draft {
        composition: composition(
            "restored",
            request.core.prompt.clone(),
            request.core.negative_prompt.clone().unwrap_or_default(),
        ),
        settings: ResolvedSettings::from_request(request).explicit(),
        characters: request
            .characters
            .as_ref()
            .map(|set| {
                set.characters
                    .iter()
                    .enumerate()
                    .map(|(index, character)| {
                        let id = format!("restored-character-{index}");
                        CharacterComposition {
                            composition: composition(
                                &id,
                                character.prompt.clone(),
                                character.negative_prompt.clone().unwrap_or_default(),
                            ),
                            id,
                            enabled: character.enabled,
                            position: character.position,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default(),
        inputs,
        ..Draft::default()
    }
}

fn known_identifier<T: serde::de::DeserializeOwned>(value: Option<&String>) -> Option<T> {
    value.and_then(|value| serde_json::from_value(serde_json::Value::String(value.clone())).ok())
}

/// Recovers only known metadata values; absent masks, image references and character positions
/// remain absent. Embedded prompt text is already conditioned, so automatic tags are disabled.
#[must_use]
pub fn draft_from_metadata(metadata: &ImageMetadata) -> Draft {
    Draft {
        composition: composition(
            "metadata",
            metadata.prompt.clone().unwrap_or_default(),
            metadata.negative_prompt.clone().unwrap_or_default(),
        ),
        settings: GenerationSettings {
            model: known_identifier(metadata.model.as_ref()),
            size: metadata
                .width
                .zip(metadata.height)
                .map(|(width, height)| ImageSize { width, height }),
            steps: metadata.steps,
            scale: metadata.scale,
            seed: metadata.seed,
            sampler: known_identifier(metadata.sampler.as_ref()),
            noise_schedule: known_identifier(metadata.noise_schedule.as_ref()),
            cfg_rescale: metadata.cfg_rescale,
            quality: if metadata.prompt.is_some() || metadata.quality_toggle == Some(false) {
                Some(QualityPreset::None)
            } else {
                None
            },
            uc_preset: if metadata.negative_prompt.is_some() {
                Some(UcPreset::None)
            } else {
                // Metadata retains an untyped legacy index. It is not the current
                // SDK preset's tag_hint, so it cannot establish a typed selection.
                None
            },
            ..GenerationSettings::default()
        },
        ..Draft::default()
    }
}

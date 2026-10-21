//! Recoverable input selections refer to immutable application media, never source paths.

use novelai_bridge::{CharacterReferenceType, DirectorCommand, Model};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct CreationInputs {
    pub operation: CreationOperation,
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
    },
    Inpainting {
        asset_id: String,
        mask_asset_id: String,
        strength: f32,
        noise: f32,
        add_original_image: bool,
    },
    Director {
        asset_id: String,
        #[cfg_attr(
            feature = "typegen",
            ts(
                type = "\"lineart\" | \"sketch\" | \"bg_removal\" | \"declutter\" | { emotion: { prompt: string; defry: number } } | { colorize: { prompt: string | null; defry: number } }"
            )
        )]
        command: DirectorCommand,
    },
    EncodeVibe {
        asset_id: String,
        #[cfg_attr(feature = "typegen", ts(type = "string"))]
        model: Model,
        information_extracted: f32,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ReferenceInputs {
    pub precise: Vec<PreciseReferenceInput>,
    pub vibes: Vec<VibeReferenceInput>,
    pub vibe_strength: Option<f32>,
}

impl ReferenceInputs {
    /// Adds recipe outputs in order and overlays their optional overall strength.
    pub fn append(&mut self, values: &Self) {
        self.precise.extend(values.precise.iter().cloned());
        self.vibes.extend(values.vibes.iter().cloned());
        if values.vibe_strength.is_some() {
            self.vibe_strength = values.vibe_strength;
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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct VibeReferenceInput {
    pub id: String,
    pub enabled: bool,
    pub asset_id: String,
    pub strength: f32,
}

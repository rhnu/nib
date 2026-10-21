//! Typed instance edits for recipe outputs; numeric legality remains with the SDK.

use novelai_bridge::{CharacterPosition, CharacterReferenceType};
use serde::{Deserialize, Serialize};

use crate::session::VibeInput;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PresetOutputOverrides {
    pub characters: Vec<CharacterOutputOverride>,
    pub precise: Vec<PreciseReferenceOverride>,
    pub vibes: Vec<VibeReferenceOverride>,
    pub normalize_vibe_strength: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct CharacterOutputOverride {
    pub character_id: String,
    pub enabled: Option<bool>,
    #[cfg_attr(feature = "typegen", ts(type = "{ x: number; y: number } | null"))]
    pub position: Option<CharacterPosition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PreciseReferenceOverride {
    pub id: String,
    pub enabled: Option<bool>,
    pub asset_id: Option<String>,
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub reference_type: Option<CharacterReferenceType>,
    pub strength: Option<f32>,
    pub fidelity: Option<f32>,
    pub information_extracted: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct VibeReferenceOverride {
    pub id: String,
    pub enabled: Option<bool>,
    pub input: Option<VibeInput>,
    pub strength: Option<f32>,
}

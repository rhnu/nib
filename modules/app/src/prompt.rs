//! Prompt resources, instances, deterministic composition and source explanations.
//!
//! `NovelAI` parameter semantics remain owned by novelai-bridge.

mod resolution;
mod sqlite;
pub(crate) mod validation;

use novelai_bridge::{ImageSize, Model, Sampler};
pub use resolution::*;
use serde::{Deserialize, Serialize};
pub use validation::{ValidationError, validate_resource};

use crate::persistence::PersistenceError;

/// Sparse application settings. Missing values inherit from earlier layers.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct GenerationSettings {
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub model: Option<Model>,
    #[cfg_attr(
        feature = "typegen",
        ts(type = "{ width: number; height: number } | null")
    )]
    pub size: Option<ImageSize>,
    pub steps: Option<u32>,
    pub scale: Option<f32>,
    #[cfg_attr(feature = "typegen", ts(type = "string | null"))]
    pub sampler: Option<Sampler>,
}

/// A stable entry in either scope of a composition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum PromptNode {
    Text {
        id: String,
        enabled: bool,
        text: String,
    },
    Chunk {
        id: String,
        enabled: bool,
        resource_id: String,
        override_text: Option<String>,
    },
}

impl PromptNode {
    pub fn id(&self) -> &str {
        match self {
            Self::Text { id, .. } | Self::Chunk { id, .. } => id,
        }
    }

    pub fn enabled(&self) -> bool {
        match self {
            Self::Text { enabled, .. } | Self::Chunk { enabled, .. } => *enabled,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct Composition {
    pub positive: Vec<PromptNode>,
    pub negative: Vec<PromptNode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct Resource {
    pub id: String,
    pub revision: u32,
    pub name: String,
    pub content: ResourceContent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ResourceContent {
    Chunk {
        text: String,
    },
    Preset {
        composition: Composition,
        defaults: GenerationSettings,
    },
}

/// Instance edits target definition entry identity, never its position or name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct InstanceOverride {
    pub node_id: String,
    pub enabled: Option<bool>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum PresetBinding {
    Linked {
        resource_id: String,
        overrides: Vec<InstanceOverride>,
    },
    Expanded {
        name: String,
        composition: Composition,
        defaults: GenerationSettings,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PresetInstance {
    pub id: String,
    pub enabled: bool,
    pub binding: PresetBinding,
}

pub trait ResourceReader {
    /// Reads the current definition, returning `None` for a missing resource.
    ///
    /// # Errors
    /// Returns the backend failure when the resource cannot be read or decoded.
    fn get_resource(&self, id: &str) -> Result<Option<Resource>, PersistenceError>;
}

pub trait ResourceWriter {
    /// Saves a structurally valid definition using its expected revision.
    ///
    /// # Errors
    /// Returns validation, revision conflict, missing-record or backend failures.
    fn save_resource(&self, resource: &Resource) -> Result<Resource, PersistenceError>;

    /// Deletes the resource only if its revision still matches.
    ///
    /// # Errors
    /// Returns a missing-record, revision conflict or backend failure.
    fn delete_resource(&self, id: &str, revision: u32) -> Result<(), PersistenceError>;
}

#[cfg(test)]
mod tests;

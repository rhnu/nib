//! Prompt resources, instances, deterministic composition and source explanations.
//!
//! `NovelAI` parameter semantics remain owned by novelai-bridge.

mod analysis;
mod overrides;
pub use analysis::{PromptSourceLocation, ResolvedPromptAnalysis};
pub use nib_prompt;
mod resolution;
mod settings;
mod tokens;

pub use overrides::*;
pub use settings::*;
pub use tokens::{TokenInspection, inspect_tokens};
mod sqlite;
pub use sqlite::ResourceSnapshot;
pub(crate) mod validation;

use novelai_bridge::CharacterPosition;
pub use resolution::*;
use serde::{Deserialize, Serialize};
pub use validation::{ValidationError, validate_resource};

use crate::{persistence::PersistenceError, session::ReferenceInputs};

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

/// An independently positioned prompt target with stable identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct CharacterComposition {
    pub id: String,
    pub enabled: bool,
    pub composition: Composition,
    #[cfg_attr(feature = "typegen", ts(type = "{ x: number; y: number }"))]
    pub position: CharacterPosition,
}

/// Namespaces an output identity without assigning syntax to either opaque source identity.
/// Direct outputs are encoded too, so a local identity cannot impersonate a scoped output.
#[must_use]
pub fn scoped_output_id(instance_id: Option<&str>, local_id: &str) -> String {
    serde_json::json!([instance_id, local_id]).to_string()
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
        #[serde(default)]
        characters: Vec<CharacterComposition>,
        #[serde(default)]
        references: ReferenceInputs,
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
        settings_overrides: GenerationSettings,
        #[serde(default)]
        output_overrides: PresetOutputOverrides,
    },
    Expanded {
        name: String,
        composition: Composition,
        defaults: GenerationSettings,
        #[serde(default)]
        characters: Vec<CharacterComposition>,
        #[serde(default)]
        references: ReferenceInputs,
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

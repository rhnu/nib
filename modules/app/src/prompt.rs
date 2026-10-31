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
pub(crate) mod sqlite;
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
    pub name: String,
    pub description: String,
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    pub models: Vec<String>,
    pub folder_id: Option<String>,
    pub cover_asset_id: Option<String>,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub created_at: i64,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub updated_at: i64,
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
    /// Creates or updates a structurally valid definition explicitly.
    ///
    /// # Errors
    /// Returns validation, duplicate identity, missing-record or backend failures.
    fn save_resource(
        &self,
        resource: &Resource,
        mode: crate::library::ResourceSaveMode,
    ) -> Result<Resource, PersistenceError>;

    /// Deletes the resource by its stable identity.
    ///
    /// # Errors
    /// Returns a missing-record or backend failure.
    fn delete_resource(&self, id: &str) -> Result<(), PersistenceError>;
}

#[cfg(test)]
mod tests;

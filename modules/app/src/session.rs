//! Automatically retained current creation. The frontend owns high-frequency edits.

use std::collections::BTreeMap;

mod director;
mod inputs;
mod mask_editor;
mod png_text;
mod restore;
mod sqlite;
mod validation;
pub use director::*;
pub use inputs::*;
pub use mask_editor::*;
pub use png_text::*;
pub use restore::*;
use serde::{Deserialize, Serialize};
pub use validation::validate_draft;

use crate::{
    persistence::PersistenceError,
    prompt::{CharacterComposition, Composition, GenerationSettings, PresetInstance},
};

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct Draft {
    pub composition: Composition,
    pub presets: Vec<PresetInstance>,
    pub settings: GenerationSettings,
    #[serde(default)]
    pub characters: Vec<CharacterComposition>,
    #[serde(default)]
    pub inputs: CreationInputs,
    pub prompt_editor: PromptEditorState,
    pub mask_editor: MaskEditorState,
    // Separately retained encoder edits never replace the active image operation.
    pub vibe_encoder: Option<VibeEncodingInput>,
    pub director: DirectorWorkspace,
    pub png_text_editor: PngTextEditorState,
    pub active_page: ActivePage,
}

/// Retains explicit collapse choices by opaque frontend scope and stable block identity.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PromptEditorState {
    pub collapsed_blocks: BTreeMap<String, bool>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ActivePage {
    #[default]
    Create,
    Director,
    Gallery,
    Explore,
    Library,
    Lexicon,
    Settings,
}

pub trait DraftStore {
    /// Reads the current creation, returning a blank state before its first save.
    ///
    /// # Errors
    /// Returns backend read or decoding failures.
    fn get_draft(&self) -> Result<Draft, PersistenceError>;

    /// Replaces the current creation and its media references atomically.
    ///
    /// # Errors
    /// Returns validation or backend failures.
    fn save_draft(&self, draft: &Draft) -> Result<(), PersistenceError>;
}

#[cfg(test)]
mod tests;

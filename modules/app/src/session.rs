//! Automatically retained current creation. The frontend owns high-frequency edits.

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
    pub revision: u32,
    pub composition: Composition,
    pub presets: Vec<PresetInstance>,
    pub settings: GenerationSettings,
    #[serde(default)]
    pub characters: Vec<CharacterComposition>,
    #[serde(default)]
    pub inputs: CreationInputs,
    pub mask_editor: MaskEditorState,
    // Separately retained encoder edits never replace the active image operation.
    pub vibe_encoder: Option<VibeEncodingInput>,
    pub director: DirectorWorkspace,
    pub png_text_editor: PngTextEditorState,
    pub active_page: ActivePage,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ActivePage {
    #[default]
    Create,
    Director,
    Gallery,
    Library,
    Lexicon,
    Settings,
}

/// A successful save acknowledges its revision without echoing retained editing history.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct DraftSaveReceipt {
    pub revision: u32,
}

pub trait DraftStore {
    /// Reads the current creation, returning a blank state before its first save.
    ///
    /// # Errors
    /// Returns backend read or decoding failures.
    fn get_draft(&self) -> Result<Draft, PersistenceError>;

    /// Saves a structurally valid draft using its expected revision.
    ///
    /// # Errors
    /// Returns validation, revision conflict or backend failures.
    fn save_draft(&self, draft: &Draft) -> Result<DraftSaveReceipt, PersistenceError>;
}

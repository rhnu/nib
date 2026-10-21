//! Automatically retained current creation. The frontend owns high-frequency edits.

mod sqlite;

use serde::{Deserialize, Serialize};

pub use crate::prompt::validation::validate_draft;
use crate::{
    persistence::PersistenceError,
    prompt::{Composition, GenerationSettings, PresetInstance},
};

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct Draft {
    pub revision: u32,
    pub composition: Composition,
    pub presets: Vec<PresetInstance>,
    pub settings: GenerationSettings,
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
    fn save_draft(&self, draft: &Draft) -> Result<Draft, PersistenceError>;
}

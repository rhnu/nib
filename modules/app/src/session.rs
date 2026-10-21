//! Retained creation drafts. The frontend owns high-frequency editing state.

mod sqlite;

use serde::{Deserialize, Serialize};

pub use crate::prompt::validation::validate_draft;
use crate::{
    persistence::PersistenceError,
    prompt::{Composition, GenerationSettings, PresetInstance},
};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct Draft {
    pub id: String,
    pub revision: u32,
    pub name: String,
    pub composition: Composition,
    pub presets: Vec<PresetInstance>,
    pub settings: GenerationSettings,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct DraftSummary {
    pub id: String,
    pub revision: u32,
    pub name: String,
}

impl Draft {
    /// Creates an unsaved draft without sample content or explicit SDK defaults.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            revision: 0,
            name: name.into(),
            composition: Composition::default(),
            presets: Vec::new(),
            settings: GenerationSettings::default(),
        }
    }
}

pub trait DraftStore {
    /// Reads a retained draft, returning `None` when it does not exist.
    ///
    /// # Errors
    /// Returns backend read or decoding failures.
    fn get_draft(&self, id: &str) -> Result<Option<Draft>, PersistenceError>;

    /// Lists the retained drafts without loading their compositions.
    ///
    /// # Errors
    /// Returns backend read or decoding failures.
    fn list_drafts(&self) -> Result<Vec<DraftSummary>, PersistenceError>;

    /// Saves a structurally valid draft using its expected revision.
    ///
    /// # Errors
    /// Returns validation, missing-record, revision conflict or backend failures.
    fn save_draft(&self, draft: &Draft) -> Result<Draft, PersistenceError>;

    /// Deletes a retained draft only if its revision still matches.
    ///
    /// # Errors
    /// Returns a missing-record, revision conflict or backend failure.
    fn delete_draft(&self, id: &str, revision: u32) -> Result<(), PersistenceError>;
}

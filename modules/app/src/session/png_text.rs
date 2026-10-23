//! Pending PNG text replacements belong to their immutable source image.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::prompt::{
    ValidationError,
    validation::{invalid, nonempty},
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PngTextValue {
    pub keyword: String,
    pub text: String,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PngTextEditorState {
    pub sessions: Vec<PngTextSession>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PngTextSession {
    pub asset_id: String,
    // Explicit replacements/additions; original duplicate values are inspected separately.
    pub entries: Vec<PngTextValue>,
    pub selected_output_asset_id: Option<String>,
}

impl PngTextEditorState {
    pub(crate) fn validate(&self) -> Result<(), ValidationError> {
        let mut images = HashSet::new();
        for session in &self.sessions {
            nonempty(&session.asset_id, "pngTextEditor.sessions.assetId")?;
            if !images.insert(&session.asset_id) {
                return Err(invalid(
                    "pngTextEditor.sessions.assetId",
                    "duplicate image identity",
                ));
            }
            if let Some(id) = &session.selected_output_asset_id {
                nonempty(id, "pngTextEditor.sessions.selectedOutputAssetId")?;
            }
        }
        Ok(())
    }
}

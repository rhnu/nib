//! Pending PNG text replacements belong to their immutable source image.

use serde::{Deserialize, Serialize};

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

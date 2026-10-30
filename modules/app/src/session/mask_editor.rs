//! Recoverable canvas edits are separate from applied SDK generation inputs.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::{api::UserMessage, prompt::ValidationError};

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct MaskEditorState {
    pub active_source_id: Option<String>,
    pub sessions: Vec<MaskSession>,
}

/// One source's complete edit history, including redo commands after the cursor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct MaskSession {
    pub source_asset_id: String,
    pub width: u32,
    pub height: u32,
    pub base_mask_asset_id: Option<String>,
    pub commands: Vec<MaskCommand>,
    pub cursor: usize,
    pub revision: u32,
    pub applied_revision: u32,
    pub applied_mask_asset_id: Option<String>,
    pub brush_size: f64,
    pub zoom: f64,
    pub pan_x: f64,
    pub pan_y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum MaskCommand {
    Paint { points: Vec<MaskPoint>, size: f64 },
    Erase { points: Vec<MaskPoint>, size: f64 },
    Clear,
}

/// Image-native pixel coordinates; the renderer clips strokes to the image canvas.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct MaskPoint {
    pub x: f64,
    pub y: f64,
}

fn invalid(field: &str, message: UserMessage) -> ValidationError {
    ValidationError {
        field: format!("maskEditor.{field}"),
        message,
    }
}

fn identity(value: &str, field: &str) -> Result<(), ValidationError> {
    if value.trim().is_empty() {
        return Err(invalid(field, UserMessage::ValueRequired));
    }
    Ok(())
}

fn positive(value: f64, field: &str) -> Result<(), ValidationError> {
    if !value.is_finite() || value <= 0.0 {
        return Err(invalid(field, UserMessage::PositiveFiniteRequired));
    }
    Ok(())
}

impl MaskEditorState {
    pub(crate) fn validate(&self) -> Result<(), ValidationError> {
        let mut sources = HashSet::new();
        for session in &self.sessions {
            identity(&session.source_asset_id, "sessions.sourceAssetId")?;
            if !sources.insert(session.source_asset_id.as_str()) {
                return Err(invalid(
                    "sessions.sourceAssetId",
                    UserMessage::DuplicateMaskSource,
                ));
            }
            session.validate()?;
        }
        if let Some(active) = &self.active_source_id {
            identity(active, "activeSourceId")?;
            if !sources.contains(active.as_str()) {
                return Err(invalid("activeSourceId", UserMessage::MaskSessionMissing));
            }
        }
        Ok(())
    }
}

impl MaskSession {
    fn validate(&self) -> Result<(), ValidationError> {
        if self.width == 0 || self.height == 0 {
            return Err(invalid(
                "sessions.size",
                UserMessage::PositiveDimensionsRequired,
            ));
        }
        if self.cursor > self.commands.len() {
            return Err(invalid(
                "sessions.cursor",
                UserMessage::HistoryCursorOutOfRange,
            ));
        }
        if self.applied_revision > self.revision {
            return Err(invalid(
                "sessions.appliedRevision",
                UserMessage::AppliedRevisionOutOfRange,
            ));
        }
        for id in self
            .base_mask_asset_id
            .iter()
            .chain(&self.applied_mask_asset_id)
        {
            identity(id, "sessions.maskAssetId")?;
        }
        positive(self.brush_size, "sessions.brushSize")?;
        positive(self.zoom, "sessions.zoom")?;
        if !self.pan_x.is_finite() || !self.pan_y.is_finite() {
            return Err(invalid("sessions.pan", UserMessage::FiniteRequired));
        }
        for command in &self.commands {
            match command {
                MaskCommand::Paint { points, size } | MaskCommand::Erase { points, size } => {
                    positive(*size, "sessions.commands.size")?;
                    if points.is_empty() {
                        return Err(invalid(
                            "sessions.commands.points",
                            UserMessage::ValueRequired,
                        ));
                    }
                    if points
                        .iter()
                        .any(|point| !point.x.is_finite() || !point.y.is_finite())
                    {
                        return Err(invalid(
                            "sessions.commands.points",
                            UserMessage::FiniteCoordinatesRequired,
                        ));
                    }
                },
                MaskCommand::Clear => {},
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;

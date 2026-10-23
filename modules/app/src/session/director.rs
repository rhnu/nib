//! Independent Director editing state; submissions still use the common job queue.

use novelai_bridge::{DirectorCommand, ValidationPolicy};
use serde::{Deserialize, Serialize};

use crate::prompt::{
    ValidationError,
    validation::{invalid, nonempty},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum DirectorToolKind {
    Lineart,
    Sketch,
    BgRemoval,
    Emotion,
    Declutter,
    DeclutterKeepBubbles,
    Colorize,
}

impl DirectorToolKind {
    #[must_use]
    pub fn from_command(command: &DirectorCommand) -> Self {
        match command {
            DirectorCommand::Lineart => Self::Lineart,
            DirectorCommand::Sketch => Self::Sketch,
            DirectorCommand::BgRemoval => Self::BgRemoval,
            DirectorCommand::Emotion { .. } => Self::Emotion,
            DirectorCommand::Declutter => Self::Declutter,
            DirectorCommand::DeclutterKeepBubbles => Self::DeclutterKeepBubbles,
            DirectorCommand::Colorize { .. } => Self::Colorize,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct DirectorToolState {
    pub tool: DirectorToolKind,
    pub asset_id: Option<String>,
    #[cfg_attr(
        feature = "typegen",
        ts(
            type = "\"lineart\" | \"sketch\" | \"bg_removal\" | \"declutter\" | \"declutter_keep_bubbles\" | { emotion: { prompt: string; defry: number } } | { colorize: { prompt: string | null; defry: number } }"
        )
    )]
    pub command: DirectorCommand,
    #[cfg_attr(feature = "typegen", ts(type = "\"normalize\" | \"reject\""))]
    pub policy: ValidationPolicy,
    pub selected_result_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct DirectorWorkspace {
    pub selected_tool: DirectorToolKind,
    pub tools: Vec<DirectorToolState>,
}

impl Default for DirectorWorkspace {
    fn default() -> Self {
        use DirectorToolKind as Kind;
        Self {
            selected_tool: Kind::Lineart,
            tools: [
                (Kind::Lineart, DirectorCommand::Lineart),
                (Kind::Sketch, DirectorCommand::Sketch),
                (Kind::BgRemoval, DirectorCommand::BgRemoval),
                // These are initial application form values, not SDK request defaults.
                (
                    Kind::Emotion,
                    DirectorCommand::Emotion {
                        prompt: String::new(),
                        defry: 0,
                    },
                ),
                (Kind::Declutter, DirectorCommand::Declutter),
                (
                    Kind::DeclutterKeepBubbles,
                    DirectorCommand::DeclutterKeepBubbles,
                ),
                (
                    Kind::Colorize,
                    DirectorCommand::Colorize {
                        prompt: None,
                        defry: 0,
                    },
                ),
            ]
            .into_iter()
            .map(|(tool, command)| DirectorToolState {
                tool,
                asset_id: None,
                command,
                policy: ValidationPolicy::default(),
                selected_result_id: None,
            })
            .collect(),
        }
    }
}

impl DirectorWorkspace {
    pub(crate) fn validate(&self) -> Result<(), ValidationError> {
        let mut tools = Vec::new();
        for state in &self.tools {
            if tools.contains(&state.tool) {
                return Err(invalid("director.tools", "duplicate tool identity"));
            }
            if state.tool != DirectorToolKind::from_command(&state.command) {
                return Err(invalid(
                    "director.tools.command",
                    "command belongs to a different tool",
                ));
            }
            tools.push(state.tool);
            if let Some(id) = &state.asset_id {
                nonempty(id, "director.tools.assetId")?;
            }
            if let Some(id) = &state.selected_result_id {
                nonempty(id, "director.tools.selectedResultId")?;
            }
        }
        if !tools.is_empty() && !tools.contains(&self.selected_tool) {
            return Err(invalid("director.selectedTool", "selected tool is missing"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;

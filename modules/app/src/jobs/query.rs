//! Task list contracts and projections, separate from frozen execution inputs.

use serde::{Deserialize, Serialize};

use super::{FrozenSubmission, JobObservation, JobRecord, JobStatus};
use crate::settings::ExecutionPreferences;

/// List views retain only the operation identity needed for feedback and reuse actions.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum OperationSummary {
    Generation {
        sample_count: u32,
        source_asset_id: Option<String>,
    },
    Director {
        tool: crate::session::DirectorToolKind,
        asset_id: String,
    },
    EncodeVibe {
        input: crate::session::VibeEncodingInput,
    },
    Upscale {
        asset_id: String,
    },
}

impl From<&FrozenSubmission> for OperationSummary {
    fn from(submission: &FrozenSubmission) -> Self {
        match submission {
            FrozenSubmission::Generation {
                request, resolved, ..
            } => {
                let source_asset_id = match &resolved.inputs.operation {
                    crate::session::CreationOperation::TextToImage => None,
                    crate::session::CreationOperation::ImageToImage { asset_id, .. }
                    | crate::session::CreationOperation::Inpainting { asset_id, .. }
                    | crate::session::CreationOperation::Director { asset_id, .. }
                    | crate::session::CreationOperation::Upscale { asset_id, .. } => {
                        Some(asset_id.clone())
                    },
                    crate::session::CreationOperation::EncodeVibe(input) => {
                        Some(input.asset_id.clone())
                    },
                };
                Self::Generation {
                    sample_count: request.core.n_samples,
                    source_asset_id,
                }
            },
            FrozenSubmission::Director {
                asset_id, command, ..
            } => Self::Director {
                tool: crate::session::DirectorToolKind::from_command(command),
                asset_id: asset_id.clone(),
            },
            FrozenSubmission::EncodeVibe {
                asset_id,
                model,
                information_extracted,
                mask_asset_id,
                crop_to_mask,
                focus_seed,
                info_extract_seed,
                ..
            } => Self::EncodeVibe {
                input: crate::session::VibeEncodingInput {
                    asset_id: asset_id.clone(),
                    model: *model,
                    information_extracted: *information_extracted,
                    mask_asset_id: mask_asset_id.clone(),
                    crop_to_mask: *crop_to_mask,
                    focus_seed: *focus_seed,
                    info_extract_seed: *info_extract_seed,
                },
            },
            FrozenSubmission::Upscale { asset_id, .. } => Self::Upscale {
                asset_id: asset_id.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct JobQuery {
    pub limit: u32,
    pub before: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct JobSummary {
    pub id: String,
    pub status: JobStatus,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub submitted_at: i64,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub finished_at: Option<i64>,
    pub error: Option<String>,
    pub result_ids: Vec<String>,
    pub operation: OperationSummary,
    pub execution: ExecutionPreferences,
    pub observation: Option<JobObservation>,
}

impl From<&JobRecord> for JobSummary {
    fn from(record: &JobRecord) -> Self {
        Self {
            id: record.id.clone(),
            status: record.status,
            submitted_at: record.submitted_at,
            finished_at: record.finished_at,
            error: record.error.clone(),
            result_ids: record.result_ids.clone(),
            operation: OperationSummary::from(&record.submission),
            execution: record.execution.clone(),
            observation: record.observation.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct JobPage {
    /// Terminal history, newest first, independently paged from active tasks.
    pub items: Vec<JobSummary>,
    pub active: Vec<JobSummary>,
    pub next_cursor: Option<String>,
}

#[cfg(test)]
mod tests;

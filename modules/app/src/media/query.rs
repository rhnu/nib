//! Result list contracts without frozen generation content.

use serde::{Deserialize, Serialize};

use super::{AssetKind, GenerationResult, MediaAsset, ResultImageSource};
use crate::jobs::OperationSummary;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResultQuery {
    pub kind: Option<AssetKind>,
    pub job_id: Option<String>,
    pub limit: u32,
    pub before: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResultSummary {
    pub id: String,
    pub job_id: String,
    pub sample_index: u32,
    pub asset_id: String,
    pub kind: AssetKind,
    pub image_source: Option<ResultImageSource>,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub seed: Option<i64>,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub created_at: i64,
    pub mime_type: String,
    pub available: bool,
    pub operation: OperationSummary,
}

impl From<&GenerationResult> for ResultSummary {
    fn from(result: &GenerationResult) -> Self {
        Self {
            id: result.id.clone(),
            job_id: result.job_id.clone(),
            sample_index: result.sample_index,
            asset_id: result.asset_id.clone(),
            kind: result.kind,
            image_source: result.image_source.clone(),
            seed: result.seed,
            created_at: result.created_at,
            mime_type: result.mime_type.clone(),
            available: result.available,
            operation: OperationSummary::from(&result.submission),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResultPage {
    pub items: Vec<ResultSummary>,
    pub next_cursor: Option<String>,
}

pub(super) struct ListedOutput {
    pub(super) result: ResultSummary,
    pub(super) asset: MediaAsset,
}

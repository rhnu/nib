//! Image safety evidence is independent of display preferences and image ownership.

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
#[expect(
    clippy::struct_excessive_bools,
    reason = "Scanning, optional review and two display contexts are independent user preferences"
)]
pub struct SafetyPreferences {
    pub auto_scan: bool,
    pub use_wd_review: bool,
    pub blur_nsfw: bool,
    pub blur_details: bool,
}

impl Default for SafetyPreferences {
    fn default() -> Self {
        Self {
            auto_scan: true,
            use_wd_review: true,
            blur_nsfw: true,
            blur_details: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum SafetyStatus {
    Unknown,
    Safe,
    Nsfw,
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct RatingScores {
    pub general: f32,
    pub sensitive: f32,
    pub questionable: f32,
    pub explicit: f32,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct SafetyModelEvidence {
    pub model_id: String,
    pub model_version: String,
    pub model_revision: String,
    pub generation: String,
    pub ratings: RatingScores,
    pub fused_score: f32,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum SafetyReview {
    NotNeeded,
    Disabled,
    Completed {
        evidence: SafetyModelEvidence,
    },
    Failed {
        model_revision: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct SafetyAssessment {
    pub status: SafetyStatus,
    pub policy_id: String,
    pub policy_version: String,
    pub primary: SafetyModelEvidence,
    pub review: SafetyReview,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub assessed_at: i64,
}

/// Skipped and failed attempts retain the last completed evidence and verdict.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ImageSafety {
    pub asset_id: String,
    pub status: SafetyStatus,
    pub reason: Option<String>,
    pub assessment: Option<SafetyAssessment>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ExtractedTag {
    pub name: String,
    pub prompt_text: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ImageTags {
    pub general: Vec<ExtractedTag>,
    pub characters: Vec<ExtractedTag>,
    pub model_version: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ImageAnalysisStatus {
    pub anime_available: bool,
    pub wd_available: bool,
    pub anime_version: Option<String>,
    pub wd_version: Option<String>,
}

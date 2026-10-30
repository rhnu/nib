//! Serializable types shared by the application and its host interfaces.

mod messages;
pub use messages::{UserMessage, error_detail};

mod models;
pub use models::{
    CharacterPositionOptions, GenerationRanges, ModelCapabilities, NumericRange,
    PreciseReferenceOptions, ReferenceStatus, SizePreset, VibeReferenceOptions, model_capabilities,
    model_defaults_capabilities,
};

/// Application metadata displayed by the desktop client.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub default_model_id: String,
}

/// Initial creation and only the resource definitions needed by its editors.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct WorkspaceSnapshot {
    pub info: AppInfo,
    pub resources: Vec<crate::prompt::Resource>,
    pub draft: crate::session::Draft,
    pub models: Vec<String>,
}

/// One consistent composition read supplies both editor text and model choices.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct DraftAnalysis {
    pub resolved: crate::prompt::ResolvedDraft,
    pub capabilities: Option<ModelCapabilities>,
}

/// Actionable error categories at the IPC boundary.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ErrorCode {
    Unavailable,
    NotFound,
    Conflict,
    Invalid,
    Unresolved,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ApiError {
    pub code: ErrorCode,
    pub message: UserMessage,
    pub validation_fields: Vec<String>,
}

/// Preserves typed SDK locations for editor focus without parsing human error messages.
#[must_use]
pub fn request_error_fields(error: &novelai_bridge::InvalidRequest) -> Vec<String> {
    use novelai_bridge::InvalidRequest;
    match error {
        InvalidRequest::PromptTokenLimitExceeded { field, .. }
        | InvalidRequest::EmptyField { field }
        | InvalidRequest::NumericOutOfRange { field, .. }
        | InvalidRequest::InvalidImageDimension { field, .. }
        | InvalidRequest::NonFiniteNumber { field, .. }
        | InvalidRequest::InvalidDataUrl { field, .. }
        | InvalidRequest::InvalidBase64 { field, .. }
        | InvalidRequest::UndecodableImage { field, .. }
        | InvalidRequest::RequiredFieldForContext { field, .. }
        | InvalidRequest::ZeroImageDimension { field } => vec![field.to_string()],
        InvalidRequest::UnsupportedModelFeature { feature, .. } => vec![feature.to_string()],
        InvalidRequest::UnsupportedFieldCombination { left, right } => {
            vec![left.to_string(), right.to_string()]
        },
        InvalidRequest::InvalidEnhanceDimensions { .. } => {
            vec![novelai_bridge::GenerationField::Size.to_string()]
        },
        _ => Vec::new(),
    }
}

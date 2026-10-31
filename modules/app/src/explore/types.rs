use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ExploreSource {
    Danbooru,
    NovelAi,
}

/// A source identity includes the connection revision that authorized its retrieval.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ExploreItemKey {
    pub source: ExploreSource,
    pub id: String,
    pub auth_revision: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ExploreRating {
    General,
    Sensitive,
    Questionable,
    Explicit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum NovelAiSort {
    New,
    Top,
    Hot,
    Random,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum NovelAiPeriod {
    Day,
    Week,
    Month,
}

/// Typed source queries retain the filters each upstream actually supports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "source",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ExploreQuery {
    Danbooru {
        tags: String,
        ratings: Vec<ExploreRating>,
    },
    NovelAi {
        sort: NovelAiSort,
        period: Option<NovelAiPeriod>,
        tags: Vec<String>,
        creator_id: Option<String>,
        random_seed: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ExploreSummary {
    pub key: ExploreItemKey,
    pub title: String,
    pub author: Option<String>,
    pub website_url: String,
    pub width: u32,
    pub height: u32,
    pub rating: Option<ExploreRating>,
    pub created_at: String,
    pub score: Option<i32>,
    pub prompt: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ExplorePage {
    pub items: Vec<ExploreSummary>,
    pub next_cursor: Option<String>,
    pub total: Option<u32>,
    pub auth_revision: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ExploreTagGroup {
    pub category: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ExploreParameter {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ExploreMetadataStatus {
    Missing,
    Available,
    Partial,
    Invalid,
}

/// Website metadata is descriptive input; SDK validation remains authoritative.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ExploreMetadata {
    pub status: ExploreMetadataStatus,
    pub prompt: Option<String>,
    pub negative_prompt: Option<String>,
    pub characters: Vec<String>,
    pub negative_characters: Vec<String>,
    pub parameters: Vec<ExploreParameter>,
    pub warnings: Vec<String>,
    pub raw: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "source",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ExploreDetails {
    Danbooru {
        tag_groups: Vec<ExploreTagGroup>,
        source_url: Option<String>,
        file_ext: String,
    },
    NovelAi {
        description: String,
        creator_id: Option<String>,
        metadata: ExploreMetadata,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ExploreDetail {
    pub summary: ExploreSummary,
    pub details: ExploreDetails,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ExploreMediaVariant {
    Thumbnail,
    Preview,
    Original,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ExploreErrorKind {
    InvalidQuery,
    StaleIdentity,
    Unauthorized,
    Forbidden,
    NotFound,
    RateLimited,
    Unavailable,
    InvalidResponse,
    MediaRejected,
}

/// Public errors omit request URLs and transport details, which may contain secrets.
#[derive(Debug, thiserror::Error, Serialize)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ExploreError {
    pub kind: ExploreErrorKind,
    pub message: String,
    pub retry_after_seconds: Option<u32>,
    #[source]
    #[serde(skip)]
    #[cfg_attr(feature = "typegen", ts(skip))]
    source: Option<Box<dyn std::error::Error + Send + Sync>>,
}

impl ExploreError {
    pub fn new(kind: ExploreErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            retry_after_seconds: None,
            source: None,
        }
    }

    /// Preserves a local diagnostic cause without serializing it to the frontend.
    #[must_use]
    pub fn with_source(mut self, source: impl std::error::Error + Send + Sync + 'static) -> Self {
        self.source = Some(Box::new(source));
        self
    }
}

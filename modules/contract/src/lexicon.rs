//! Vocabulary queries and resource state owned by their application consumer.

/// Danbooru categories remain distinct; style groups are metadata on general terms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum LexiconKind {
    General,
    Artist,
    Copyright,
    Character,
    Meta,
}

/// A term's stable identity never depends on a database row or vector position.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct LexiconTerm {
    pub key: String,
    pub name: String,
    pub prompt_text: String,
    pub kind: LexiconKind,
    pub translation: Option<String>,
    pub description: Option<String>,
    pub post_count: u32,
    pub aliases: Vec<String>,
    pub groups: Vec<String>,
    pub source: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum LexiconMatchReason {
    Name,
    Alias,
    Translation,
    Semantic,
    Related,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct LexiconMatch {
    pub term: LexiconTerm,
    pub reason: LexiconMatchReason,
    pub score: f32,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct LexiconQuery {
    pub text: String,
    pub kinds: Vec<LexiconKind>,
    pub semantic: bool,
    pub limit: u32,
    #[serde(default)]
    #[cfg_attr(feature = "typegen", ts(optional))]
    pub related_to: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct LexiconSearchResult {
    pub generation: Option<String>,
    pub matches: Vec<LexiconMatch>,
    pub semantic_available: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct LexiconStatus {
    pub loading: bool,
    pub error: Option<String>,
    pub generation: Option<String>,
    pub term_count: u32,
    pub semantic_available: bool,
}

/// One native implementation serves both the browser and all prompt editor contexts.
pub trait LexiconSearch: Send + Sync {
    /// Find canonical terms with explicit lexical, semantic or association reasons.
    ///
    /// # Errors
    /// Returns an error for invalid input or unavailable resource and inference backends.
    fn search(&self, query: LexiconQuery) -> Result<LexiconSearchResult, LexiconError>;

    /// Report the active generation and its query capabilities.
    ///
    /// # Errors
    /// Returns an error if the backend's shared state cannot be read.
    fn status(&self) -> Result<LexiconStatus, LexiconError>;
}

#[derive(Debug, thiserror::Error)]
pub enum LexiconError {
    #[error("invalid vocabulary request: {0}")]
    Invalid(String),
    #[error("vocabulary resource is unavailable: {0}")]
    Unavailable(String),
    #[error("vocabulary operation failed")]
    Failure(#[source] Box<dyn std::error::Error + Send + Sync>),
}

#[cfg(test)]
mod tests;

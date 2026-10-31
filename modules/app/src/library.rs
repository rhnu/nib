//! Resource queries, independent from resource write capabilities.

#[cfg(feature = "native")]
mod agent_edits;
mod definitions;
pub(crate) mod operations;
mod sqlite;
pub use definitions::{draft_resource_ids, resource_definitions};
use serde::{Deserialize, Serialize};

use crate::persistence::PersistenceError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ResourceKind {
    Chunk,
    Preset,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResourceSummary {
    pub id: String,
    pub name: String,
    pub kind: ResourceKind,
    pub description: String,
    pub aliases: Vec<String>,
    pub tags: Vec<String>,
    pub models: Vec<String>,
    pub folder_id: Option<String>,
    pub cover_asset_id: Option<String>,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub created_at: i64,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResourceQuery {
    pub text: String,
    pub kind: Option<ResourceKind>,
    pub tags: Vec<String>,
    pub models: Vec<String>,
    pub folder_id: Option<String>,
    pub include_subfolders: bool,
    pub root_only: bool,
    pub offset: u32,
    pub limit: u32,
    pub sort: ResourceSort,
    pub descending: bool,
}

pub trait ResourceSearch {
    /// Finds resources matching the requested text and optional kind.
    ///
    /// # Errors
    /// Returns backend query or decoding failures.
    fn search_resources(&self, query: &ResourceQuery) -> Result<ResourcePage, PersistenceError>;
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResourcePage {
    pub items: Vec<ResourceSummary>,
    pub total: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResourceFolder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub created_at: i64,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub updated_at: i64,
}

/// Explicitly distinguishes first persistence from replacing an existing resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ResourceSaveMode {
    Create,
    Update,
}

/// Folder writes carry only the fields the caller intends to change.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ResourceFolderEdit {
    Create {
        id: String,
        name: String,
        parent_id: Option<String>,
    },
    Update {
        id: String,
        changes: Vec<ResourceFolderChange>,
    },
}

/// One intentional folder field change, including an explicit move to the root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ResourceFolderChange {
    Name { name: String },
    Parent { parent_id: Option<String> },
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResourceSelection {
    pub resources: Vec<String>,
    pub folders: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ResourceBatchAction {
    Move {
        folder_id: Option<String>,
    },
    Copy {
        folder_id: Option<String>,
    },
    Delete,
    Metadata {
        tags: Option<Vec<String>>,
        models: Option<Vec<String>>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResourceImpact {
    pub resources: Vec<ResourceSummary>,
    pub folders: Vec<ResourceFolder>,
    pub referencing_resources: Vec<ResourceSummary>,
    pub current_creation: bool,
}

pub(crate) fn invalid(message: crate::api::UserMessage) -> PersistenceError {
    PersistenceError::InvalidData { message }
}

pub(crate) fn validate_id(id: &str) -> Result<(), PersistenceError> {
    match uuid::Uuid::parse_str(id) {
        Ok(value) if value.hyphenated().to_string() == id && !value.is_nil() => Ok(()),
        _ => Err(invalid(crate::api::UserMessage::InvalidResourceId)),
    }
}

impl Default for ResourceQuery {
    fn default() -> Self {
        Self {
            text: String::new(),
            kind: None,
            tags: Vec::new(),
            models: Vec::new(),
            folder_id: None,
            include_subfolders: false,
            root_only: false,
            offset: 0,
            limit: 50,
            sort: ResourceSort::Name,
            descending: false,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ResourceSort {
    #[default]
    Name,
    CreatedAt,
    UpdatedAt,
}

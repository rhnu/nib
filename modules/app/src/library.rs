//! Resource queries, independent from resource write capabilities.

mod definitions;
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
    pub revision: u32,
    pub name: String,
    pub kind: ResourceKind,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResourceQuery {
    pub text: String,
    pub kind: Option<ResourceKind>,
}

pub trait ResourceSearch {
    /// Finds resources matching the requested text and optional kind.
    ///
    /// # Errors
    /// Returns backend query or decoding failures.
    fn search_resources(
        &self,
        query: &ResourceQuery,
    ) -> Result<Vec<ResourceSummary>, PersistenceError>;
}

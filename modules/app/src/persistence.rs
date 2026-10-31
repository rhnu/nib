//! SQLite lifecycle shared by the domain-owned repository implementations.

pub(crate) mod migrations;
pub(crate) mod schema;
mod sqlite;

use std::error::Error;

pub use sqlite::SqliteDatabase;
pub(crate) use sqlite::{decode, encode};

use crate::api::UserMessage;

/// A retained-data operation failed without hiding its original cause.
#[derive(Debug, thiserror::Error)]
pub enum PersistenceError {
    #[error("{operation}")]
    Failure {
        operation: &'static str,
        #[source]
        source: Box<dyn Error + Send + Sync>,
    },
    #[error("{kind} {id} no longer exists")]
    NotFound { kind: &'static str, id: String },
    #[error("{kind} {id} changed since it was loaded")]
    Conflict { kind: &'static str, id: String },
    #[error("database schema {found} is incompatible with this application")]
    UnsupportedSchema { found: i64 },
    #[error("{message}")]
    InvalidData { message: UserMessage },
    #[error("the database connection is unavailable after an interrupted operation")]
    Locked,
}

impl PersistenceError {
    /// Projects failures without losing the affected identity or local diagnostic detail.
    pub fn user_message(&self) -> UserMessage {
        match self {
            Self::InvalidData { message } => message.clone(),
            Self::NotFound { kind, id } => UserMessage::NotFound {
                entity: (*kind).to_owned(),
                id: id.clone(),
            },
            Self::Conflict { kind, id } => UserMessage::Conflict {
                entity: (*kind).to_owned(),
                id: id.clone(),
            },
            Self::UnsupportedSchema { found } => UserMessage::UnsupportedSchema {
                found: found.to_string(),
            },
            Self::Locked => UserMessage::StorageLocked,
            Self::Failure { operation, source } => UserMessage::StorageFailure {
                operation: (*operation).to_owned(),
                detail: crate::api::error_detail(source.as_ref()),
            },
        }
    }

    /// Adds the failed operation while preserving a backend error for diagnostics.
    pub fn failure(operation: &'static str, source: impl Error + Send + Sync + 'static) -> Self {
        Self::Failure {
            operation,
            source: Box::new(source),
        }
    }
}

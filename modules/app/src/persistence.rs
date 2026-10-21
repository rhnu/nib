//! SQLite lifecycle shared by the domain-owned repository implementations.

mod sqlite;

use std::error::Error;

pub use sqlite::{ResourceSnapshot, SqliteDatabase};
pub(crate) use sqlite::{decode, encode, next_revision, write_miss};

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
    #[error("database schema {found} is newer than this application supports")]
    UnsupportedSchema { found: i64 },
    #[error("{message}")]
    InvalidData { message: String },
    #[error("the database connection is unavailable after an interrupted operation")]
    Locked,
}

impl PersistenceError {
    /// Adds the failed operation while preserving a backend error for diagnostics.
    pub fn failure(operation: &'static str, source: impl Error + Send + Sync + 'static) -> Self {
        Self::Failure {
            operation,
            source: Box::new(source),
        }
    }
}

use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
    time::Duration,
};

use rusqlite::Connection;
use serde::{Serialize, de::DeserializeOwned};

use super::PersistenceError;

/// One local database, shared by independent domain capabilities.
pub struct SqliteDatabase {
    connection: Mutex<Connection>,
}

/// A read transaction used to resolve all dependencies from one database snapshot.
pub struct ResourceSnapshot<'a> {
    pub(crate) connection: &'a Connection,
}

impl SqliteDatabase {
    /// Opens retained data and initializes a new database atomically.
    ///
    /// # Errors
    /// Returns the underlying open or initialization failure, or rejects an incompatible schema.
    pub fn open(path: &Path) -> Result<Self, PersistenceError> {
        let mut connection = Connection::open(path)
            .map_err(|error| PersistenceError::failure("open the local database", error))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| {
                PersistenceError::failure("configure the database busy timeout", error)
            })?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| {
                PersistenceError::failure("read the database schema version", error)
            })?;
        if version != 0 && version != 2 {
            return Err(PersistenceError::UnsupportedSchema { found: version });
        }
        if version == 0 {
            let transaction = connection.transaction().map_err(|error| {
                PersistenceError::failure("begin the initial database migration", error)
            })?;
            transaction
                .execute_batch(include_str!("schema.sql"))
                .map_err(|error| {
                    PersistenceError::failure("apply the initial database migration", error)
                })?;
            transaction.commit().map_err(|error| {
                PersistenceError::failure("commit the initial database migration", error)
            })?;
        }
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub(crate) fn connection(&self) -> Result<MutexGuard<'_, Connection>, PersistenceError> {
        self.connection
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)
    }

    /// Keeps dependency reads consistent even if another connection changes resources.
    ///
    /// # Errors
    /// Returns transaction failures or the error produced by the supplied read operation.
    pub fn read_resources<T, E>(
        &self,
        read: impl FnOnce(&ResourceSnapshot<'_>) -> Result<T, E>,
    ) -> Result<T, E>
    where
        E: From<PersistenceError>,
    {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin a resource snapshot", error))?;
        let value = read(&ResourceSnapshot {
            connection: &transaction,
        })?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("finish a resource snapshot", error))?;
        Ok(value)
    }
}

pub(crate) fn encode<T: Serialize>(value: &T) -> Result<String, PersistenceError> {
    serde_json::to_string(value)
        .map_err(|error| PersistenceError::failure("serialize retained content", error))
}

pub(crate) fn decode<T: DeserializeOwned>(value: &str) -> Result<T, PersistenceError> {
    serde_json::from_str(value)
        .map_err(|error| PersistenceError::failure("read retained content", error))
}

pub(crate) fn next_revision(revision: u32) -> Result<u32, PersistenceError> {
    revision
        .checked_add(1)
        .ok_or_else(|| PersistenceError::InvalidData {
            message: "the record revision cannot be incremented".to_owned(),
        })
}

/// Distinguishes a removed record from an edit based on an older revision.
pub(crate) fn write_miss(
    connection: &Connection,
    table: &str,
    kind: &'static str,
    id: &str,
) -> PersistenceError {
    // Table names are selected by the repository, never taken from user input.
    let result = connection.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?1)"),
        [id],
        |row| row.get::<_, bool>(0),
    );
    match result {
        Ok(true) => PersistenceError::Conflict {
            kind,
            id: id.to_owned(),
        },
        Ok(false) => PersistenceError::NotFound {
            kind,
            id: id.to_owned(),
        },
        Err(error) => PersistenceError::failure("inspect a failed record write", error),
    }
}

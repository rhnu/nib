use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
    time::Duration,
};

use rusqlite::Connection;
use serde::{Serialize, de::DeserializeOwned};

use super::{PersistenceError, migrations::MIGRATIONS, schema};
use crate::{api::UserMessage, prompt::ResourceSnapshot};

/// One local database, shared by independent domain capabilities.
pub struct SqliteDatabase {
    connection: Mutex<Connection>,
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
            .pragma_update(None, "foreign_keys", true)
            .map_err(|error| {
                PersistenceError::failure("enable database reference integrity", error)
            })?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| {
                PersistenceError::failure("configure the database busy timeout", error)
            })?;
        let version = schema::version(&connection)?;
        if version != 0 && version != MIGRATIONS.current {
            return Err(PersistenceError::UnsupportedSchema { found: version });
        }
        if version == 0 {
            let transaction = connection.transaction().map_err(|error| {
                PersistenceError::failure("begin creation database initialization", error)
            })?;
            transaction
                .execute_batch(include_str!("schema.sql"))
                .map_err(|error| {
                    PersistenceError::failure("initialize the creation database schema", error)
                })?;
            transaction
                .pragma_update(None, "user_version", MIGRATIONS.current)
                .map_err(|error| {
                    PersistenceError::failure("record initial creation schema version", error)
                })?;
            transaction.commit().map_err(|error| {
                PersistenceError::failure("commit creation database initialization", error)
            })?;
        }
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// Flushes SQLite recovery pages after the host has stopped every creation-data writer.
    /// # Errors
    /// Returns a checkpoint failure or an active SQLite reader.
    pub fn prepare_relocation(&self) -> Result<(), PersistenceError> {
        let connection = self.connection()?;
        let (busy, ..): (i64, i64, i64) = connection
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|error| {
                PersistenceError::failure(
                    "checkpoint the creation database before relocation",
                    error,
                )
            })?;
        if busy != 0 {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::DatabaseBusy,
            });
        }
        Ok(())
    }

    /// Inspects a completed destination without initializing or changing it.
    /// # Errors
    /// Returns an unreadable or corrupt destination database.
    pub fn verify_copy(path: &Path) -> Result<(), PersistenceError> {
        let connection =
            Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(
                |error| {
                    PersistenceError::failure("open the relocated database for verification", error)
                },
            )?;
        let check: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(|error| PersistenceError::failure("verify the relocated database", error))?;
        if check != "ok" {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::DatabaseIntegrityFailed,
            });
        }
        Ok(())
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
        let value = read(&ResourceSnapshot::new(&transaction))?;
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

use std::{
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::Duration,
};

use rusqlite::{Connection, params};

use super::ApplicationPreferences;
use crate::persistence::{PersistenceError, decode, encode};

/// The effective storage location and a change waiting for the next startup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataDirectories {
    /// Absence selects the host's default data directory.
    pub current: Option<PathBuf>,
    pub pending: Option<PathBuf>,
}

/// A fixed configuration database, separate from movable creation data.
pub struct GlobalSettingsStore {
    connection: Mutex<Connection>,
}

impl GlobalSettingsStore {
    /// Opens global settings and atomically initializes a new configuration database.
    ///
    /// # Errors
    /// Returns an open or initialization failure, or rejects an incompatible schema.
    pub fn open(path: &Path) -> Result<Self, PersistenceError> {
        let connection = Connection::open(path)
            .map_err(|error| PersistenceError::failure("open global settings", error))?;
        Self::from_connection(connection)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, PersistenceError> {
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| {
                PersistenceError::failure("configure the settings busy timeout", error)
            })?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| {
                PersistenceError::failure("read the settings schema version", error)
            })?;
        if version != 0 && version != 1 {
            return Err(PersistenceError::UnsupportedSchema { found: version });
        }
        if version == 0 {
            let transaction = connection.transaction().map_err(|error| {
                PersistenceError::failure("begin global settings initialization", error)
            })?;
            transaction
                .execute_batch(include_str!("schema.sql"))
                .map_err(|error| {
                    PersistenceError::failure("initialize the settings schema", error)
                })?;
            transaction
                .execute(
                    "INSERT INTO global_settings (id, preferences_json) VALUES (1, ?1)",
                    [encode(&ApplicationPreferences::default())?],
                )
                .map_err(|error| {
                    PersistenceError::failure("initialize application preferences", error)
                })?;
            transaction.commit().map_err(|error| {
                PersistenceError::failure("commit global settings initialization", error)
            })?;
        }
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn connection(&self) -> Result<MutexGuard<'_, Connection>, PersistenceError> {
        self.connection
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)
    }

    /// Reads the global preferences without opening the creation database.
    ///
    /// # Errors
    /// Returns a backend failure or rejects invalid stored preferences.
    pub fn preferences(&self) -> Result<ApplicationPreferences, PersistenceError> {
        let value: String = self
            .connection()?
            .query_row(
                "SELECT preferences_json FROM global_settings WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|error| PersistenceError::failure("read application preferences", error))?;
        decode(&value)
    }

    /// Persists the complete preference value independently of directory changes.
    ///
    /// # Errors
    /// Returns a serialization or database failure.
    pub fn save_preferences(
        &self,
        preferences: &ApplicationPreferences,
    ) -> Result<ApplicationPreferences, PersistenceError> {
        self.connection()?
            .execute(
                "UPDATE global_settings SET preferences_json = ?1 WHERE id = 1",
                [encode(preferences)?],
            )
            .map_err(|error| PersistenceError::failure("save application preferences", error))?;
        Ok(preferences.clone())
    }

    /// Reads the effective location and any requested move.
    ///
    /// # Errors
    /// Returns a backend failure or rejects invalid stored paths.
    pub fn directories(&self) -> Result<DataDirectories, PersistenceError> {
        let connection = self.connection()?;
        read_directories(&connection)
    }

    /// Records a move for the next startup, or cancels it when given `None`.
    ///
    /// # Errors
    /// Returns a serialization or database failure.
    pub fn set_pending_directory(
        &self,
        path: Option<&Path>,
    ) -> Result<DataDirectories, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin a data directory change request", error)
        })?;
        transaction
            .execute(
                "UPDATE global_settings SET pending_directory_json = ?1 WHERE id = 1",
                [path.map(|path| encode(&path)).transpose()?],
            )
            .map_err(|error| {
                PersistenceError::failure("save the requested data directory", error)
            })?;
        let directories = read_directories(&transaction)?;
        transaction.commit().map_err(|error| {
            PersistenceError::failure("commit the data directory change request", error)
        })?;
        Ok(directories)
    }

    /// Records the active directory without consuming a move requested in this process.
    ///
    /// # Errors
    /// Returns a serialization or database failure.
    pub fn retain_current_directory(&self, path: &Path) -> Result<(), PersistenceError> {
        self.connection()?
            .execute(
                "UPDATE global_settings SET current_directory_json = ?1 WHERE id = 1",
                [encode(&path)?],
            )
            .map_err(|error| {
                PersistenceError::failure("retain the current data directory", error)
            })?;
        Ok(())
    }

    /// Publishes the successfully prepared directory and clears the pending request atomically.
    ///
    /// The host calls this only after the data has reached the destination.
    ///
    /// # Errors
    /// Returns a serialization or database failure.
    pub fn complete_directory_change(&self, path: &Path) -> Result<(), PersistenceError> {
        self.connection()?
            .execute(
                "UPDATE global_settings
                 SET current_directory_json = ?1, pending_directory_json = NULL WHERE id = 1",
                params![encode(&path)?],
            )
            .map_err(|error| {
                PersistenceError::failure("complete the data directory change", error)
            })?;
        Ok(())
    }
}

fn read_directories(connection: &Connection) -> Result<DataDirectories, PersistenceError> {
    let (current, pending): (Option<String>, Option<String>) = connection
        .query_row(
            "SELECT current_directory_json, pending_directory_json FROM global_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| PersistenceError::failure("read data directory settings", error))?;
    Ok(DataDirectories {
        current: current.as_deref().map(decode).transpose()?,
        pending: pending.as_deref().map(decode).transpose()?,
    })
}

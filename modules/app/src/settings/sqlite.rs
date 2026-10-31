use std::{
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard},
    time::Duration,
};

use rusqlite::{Connection, params};

use super::{ApplicationPreferences, migrations::MIGRATIONS};
use crate::{
    api::UserMessage,
    persistence::{PersistenceError, decode, encode, schema},
};

/// The selected creation-data directory, independent of the current process handles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataDirectories {
    /// Absence selects the host's default data directory.
    pub current: Option<PathBuf>,
}

/// A fixed configuration database, separate from movable creation data.
pub struct GlobalSettingsStore {
    connection: Mutex<Connection>,
}

impl GlobalSettingsStore {
    #[cfg(feature = "native")]
    pub(crate) fn credential_name_for_version(
        &self,
        version: &str,
    ) -> Result<String, PersistenceError> {
        self.connection()?.query_row("SELECT credentials.name FROM credentials JOIN credential_versions ON credentials.id=credential_versions.credential_id WHERE credential_versions.id=?1", [version], |row| row.get(0))
            .map_err(|error| PersistenceError::failure("read the generation account name", error))
    }

    #[cfg(feature = "native")]
    pub(crate) fn agent_permission(
        &self,
    ) -> Result<crate::agent::AgentPermission, PersistenceError> {
        let encoded: String = self
            .connection()?
            .query_row(
                "SELECT agent_generation_permission FROM global_settings WHERE id=1",
                [],
                |row| row.get(0),
            )
            .map_err(|error| {
                PersistenceError::failure("read Agent generation permission", error)
            })?;
        decode(&encoded)
    }

    #[cfg(feature = "native")]
    pub(crate) fn save_agent_permission(
        &self,
        permission: crate::agent::AgentPermission,
    ) -> Result<(), PersistenceError> {
        self.connection()?
            .execute(
                "UPDATE global_settings SET agent_generation_permission=?1 WHERE id=1",
                [encode(&permission)?],
            )
            .map_err(|error| {
                PersistenceError::failure("save Agent generation permission", error)
            })?;
        Ok(())
    }

    pub(super) fn danbooru_metadata(
        &self,
    ) -> Result<super::danbooru::DanbooruMetadata, PersistenceError> {
        self.connection()?.query_row(
            "SELECT username, secret_id, user_id, revision, valid FROM danbooru_connection WHERE id=1",
            [],
            |row| Ok(super::danbooru::DanbooruMetadata { username: row.get(0)?, secret_id: row.get(1)?, user_id: row.get(2)?, revision: row.get(3)?, valid: row.get(4)? }),
        ).map_err(|error| PersistenceError::failure("read Danbooru connection", error))
    }

    pub(super) fn save_danbooru_metadata(
        &self,
        previous_revision: u32,
        metadata: &super::danbooru::DanbooruMetadata,
    ) -> Result<bool, PersistenceError> {
        self.connection()?.execute(
            "UPDATE danbooru_connection SET username=?1, secret_id=?2, user_id=?3, revision=?4, valid=?5 WHERE id=1 AND revision=?6",
            params![metadata.username, metadata.secret_id, metadata.user_id, metadata.revision, metadata.valid, previous_revision],
        ).map(|changed| changed == 1).map_err(|error| PersistenceError::failure("save Danbooru connection", error))
    }

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
        let version = schema::version(&connection)?;
        if version != 0 && version != MIGRATIONS.current {
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
            transaction
                .pragma_update(None, "user_version", MIGRATIONS.current)
                .map_err(|error| {
                    PersistenceError::failure("record initial settings schema version", error)
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

    #[cfg(feature = "native")]
    pub(crate) fn agent_connection(
        &self,
    ) -> Result<Option<crate::agent::storage::ConnectionMetadata>, PersistenceError> {
        let value: Option<String> = self
            .connection()?
            .query_row(
                "SELECT agent_connection_json FROM global_settings WHERE id=1",
                [],
                |row| row.get(0),
            )
            .map_err(|error| PersistenceError::failure("read assistant connection", error))?;
        value.as_deref().map(decode).transpose()
    }

    #[cfg(feature = "native")]
    pub(crate) fn save_agent_connection(
        &self,
        metadata: &crate::agent::storage::ConnectionMetadata,
    ) -> Result<(), PersistenceError> {
        self.connection()?
            .execute(
                "UPDATE global_settings SET agent_connection_json=?1 WHERE id=1",
                [encode(metadata)?],
            )
            .map_err(|error| PersistenceError::failure("save assistant connection", error))?;
        Ok(())
    }

    /// Lists names and the active account without loading any secret.
    ///
    /// # Errors
    /// Returns a database failure or invalid stored account metadata.
    pub fn credentials(&self) -> Result<super::AccountStatus, PersistenceError> {
        let connection = self.connection()?;
        let mut query = connection
            .prepare("SELECT id, name, active FROM credentials ORDER BY rowid")
            .map_err(|error| PersistenceError::failure("list account names", error))?;
        let rows = query
            .query_map([], |row| {
                Ok((
                    super::CredentialProfile {
                        id: row.get(0)?,
                        name: row.get(1)?,
                    },
                    row.get::<_, bool>(2)?,
                ))
            })
            .map_err(|error| PersistenceError::failure("read account names", error))?;
        let mut credentials = Vec::new();
        let mut active_id = None;
        for row in rows {
            let (profile, active) =
                row.map_err(|error| PersistenceError::failure("read account metadata", error))?;
            if active {
                active_id = Some(profile.id.clone());
            }
            credentials.push(profile);
        }
        Ok(super::AccountStatus {
            configured: active_id.is_some(),
            active_id,
            credentials,
        })
    }

    /// Returns the immutable native-keyring identity selected for new operations.
    ///
    /// # Errors
    /// Returns a database failure while reading the selected version.
    pub fn active_credential(&self) -> Result<Option<String>, PersistenceError> {
        use rusqlite::OptionalExtension as _;
        self.connection()?
            .query_row(
                "SELECT secret_id FROM credentials WHERE active = 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| PersistenceError::failure("read the active account", error))
    }

    /// Stores a new profile or publishes a new secret version without altering old jobs.
    ///
    /// # Errors
    /// Returns a database failure, a version identity conflict or a missing profile for rename.
    pub fn save_credential(
        &self,
        id: &str,
        name: &str,
        secret_id: Option<&str>,
    ) -> Result<(), PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin account update", error))?;
        if let Some(secret_id) = secret_id {
            transaction.execute("INSERT INTO credentials(id,name,secret_id,active) VALUES (?1,?2,?3,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name,secret_id=excluded.secret_id", params![id,name,secret_id])
                .map_err(|error| PersistenceError::failure("save account metadata", error))?;
            transaction
                .execute(
                    "INSERT INTO credential_versions(id,credential_id) VALUES (?1,?2)",
                    params![secret_id, id],
                )
                .map_err(|error| PersistenceError::failure("retain account version", error))?;
            transaction.execute("UPDATE credentials SET active=1 WHERE id=?1 AND NOT EXISTS (SELECT 1 FROM credentials WHERE active=1)", [id])
                .map_err(|error| PersistenceError::failure("select the first account", error))?;
        } else {
            let updated = transaction
                .execute(
                    "UPDATE credentials SET name=?2 WHERE id=?1",
                    params![id, name],
                )
                .map_err(|error| PersistenceError::failure("rename account", error))?;
            if updated == 0 {
                return Err(PersistenceError::InvalidData {
                    message: UserMessage::AccountNotFound,
                });
            }
        }
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit account update", error))
    }

    /// Selects exactly one existing profile for future operations.
    ///
    /// # Errors
    /// Returns a database failure or rejects an unknown account.
    pub fn activate_credential(&self, id: &str) -> Result<(), PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin account selection", error))?;
        transaction
            .execute("UPDATE credentials SET active=0", [])
            .map_err(|error| PersistenceError::failure("clear active account", error))?;
        if transaction
            .execute("UPDATE credentials SET active=1 WHERE id=?1", [id])
            .map_err(|error| PersistenceError::failure("select account", error))?
            == 0
        {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::AccountNotFound,
            });
        }
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit account selection", error))
    }

    /// Retained immutable versions must be checked against unfinished tasks before deletion.
    ///
    /// # Errors
    /// Returns a database failure or invalid stored version metadata.
    pub fn credential_versions(&self, id: &str) -> Result<Vec<String>, PersistenceError> {
        let connection = self.connection()?;
        let mut query = connection
            .prepare("SELECT id FROM credential_versions WHERE credential_id=?1")
            .map_err(|error| PersistenceError::failure("list account versions", error))?;
        query
            .query_map([id], |row| row.get(0))
            .map_err(|error| PersistenceError::failure("read account versions", error))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| PersistenceError::failure("decode account versions", error))
    }

    /// Removes metadata after the native secrets were removed successfully.
    ///
    /// # Errors
    /// Returns a database failure without publishing a partial metadata removal.
    pub fn delete_credential(&self, id: &str) -> Result<(), PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin account removal", error))?;
        transaction
            .execute(
                "DELETE FROM credential_versions WHERE credential_id=?1",
                [id],
            )
            .map_err(|error| PersistenceError::failure("remove account versions", error))?;
        transaction
            .execute("DELETE FROM credentials WHERE id=?1", [id])
            .map_err(|error| PersistenceError::failure("remove account metadata", error))?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit account removal", error))
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

    /// Records the initially selected directory.
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

    /// Publishes the successfully copied and verified directory atomically.
    ///
    /// The host calls this only after the data has reached the destination.
    ///
    /// # Errors
    /// Returns a serialization or database failure.
    pub fn complete_directory_change(&self, path: &Path) -> Result<(), PersistenceError> {
        self.connection()?
            .execute(
                "UPDATE global_settings
                 SET current_directory_json = ?1 WHERE id = 1",
                params![encode(&path)?],
            )
            .map_err(|error| {
                PersistenceError::failure("complete the data directory change", error)
            })?;
        Ok(())
    }
}

fn read_directories(connection: &Connection) -> Result<DataDirectories, PersistenceError> {
    let current: Option<String> = connection
        .query_row(
            "SELECT current_directory_json FROM global_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|error| PersistenceError::failure("read data directory settings", error))?;
    Ok(DataDirectories {
        current: current.as_deref().map(decode).transpose()?,
    })
}

#[cfg(test)]
mod tests;

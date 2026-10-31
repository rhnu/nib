//! Schema upgrades run by the host under directory locks before business startup.

use std::{path::Path, time::Duration};

use rusqlite::{Connection, OpenFlags, Transaction, TransactionBehavior};

use crate::persistence::{PersistenceError, schema::version};

/// Upgrades an existing settings database without creating or initializing one.
/// The caller must hold the configuration directory lock before opening settings.
/// # Errors
/// Returns an unsupported version or a database upgrade failure.
pub fn upgrade_settings(path: &Path) -> Result<(), PersistenceError> {
    crate::settings::migrations::MIGRATIONS.upgrade(path)
}

/// Upgrades existing creation data before any domain repositories or workers open it.
/// The caller must hold the creation-data directory lock until application shutdown.
/// # Errors
/// Returns an unsupported version or a database upgrade failure.
pub fn upgrade_creation(path: &Path) -> Result<(), PersistenceError> {
    crate::persistence::migrations::MIGRATIONS.upgrade(path)
}

/// One upgrade from `from` to `from + 1`; steps must leave transaction control to the runner.
pub(crate) struct Migration {
    pub from: i64,
    pub apply: fn(&Transaction<'_>) -> Result<(), PersistenceError>,
}

/// Each database owns its current version and ordered upgrades from stable schema 1.
pub(crate) struct DatabaseMigrations {
    pub name: &'static str,
    pub current: i64,
    pub steps: &'static [Migration],
}

impl DatabaseMigrations {
    fn pending(&self, found: i64) -> Result<&[Migration], PersistenceError> {
        let unsupported = || PersistenceError::UnsupportedSchema { found };
        if found < 1 || found > self.current {
            return Err(unsupported());
        }
        if found == self.current {
            return Ok(&[]);
        }
        let start = self
            .steps
            .iter()
            .position(|step| step.from == found)
            .ok_or_else(unsupported)?;
        let steps = &self.steps[start..];
        if i64::try_from(steps.len()).ok() != Some(self.current - found)
            || steps
                .iter()
                .zip(found..self.current)
                .any(|(step, expected)| step.from != expected)
        {
            return Err(unsupported());
        }
        Ok(steps)
    }

    fn upgrade(&self, path: &Path) -> Result<(), PersistenceError> {
        if !path
            .try_exists()
            .map_err(|error| PersistenceError::failure("locate database for upgrade", error))?
        {
            return Ok(());
        }
        let mut connection =
            Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
                .map_err(|error| PersistenceError::failure("open database for upgrade", error))?;
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(|error| PersistenceError::failure("configure upgrade busy timeout", error))?;
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(|error| {
                PersistenceError::failure("enable upgrade reference integrity", error)
            })?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| PersistenceError::failure("begin schema upgrade", error))?;
        let found = version(&transaction)?;
        // A genuinely empty database belongs to initialization, never to the upgrade history.
        if found == 0 {
            return Ok(());
        }
        let steps = self.pending(found)?;
        if steps.is_empty() {
            return Ok(());
        }
        tracing::info!(
            database = self.name,
            from = found,
            to = self.current,
            "upgrading database schema"
        );
        for step in steps {
            (step.apply)(&transaction)?;
            transaction
                .pragma_update(None, "user_version", step.from + 1)
                .map_err(|error| {
                    PersistenceError::failure("record upgraded schema version", error)
                })?;
        }
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit schema upgrade", error))?;
        tracing::info!(
            database = self.name,
            version = self.current,
            "database schema upgraded"
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests;

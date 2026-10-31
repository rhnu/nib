//! Shared version inspection; version zero is reserved for an empty database.

use rusqlite::Connection;

use super::PersistenceError;

pub(crate) fn version(connection: &Connection) -> Result<i64, PersistenceError> {
    let version = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| PersistenceError::failure("read database schema version", error))?;
    if version == 0 {
        let populated: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*')",
                [],
                |row| row.get(0),
            )
            .map_err(|error| PersistenceError::failure("inspect unversioned database", error))?;
        if populated {
            return Err(PersistenceError::UnsupportedSchema { found: version });
        }
    }
    Ok(version)
}

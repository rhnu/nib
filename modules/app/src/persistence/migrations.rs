//! Creation schema history. Add a step for each increase of the stable schema version.

use rusqlite::{OptionalExtension as _, Transaction, params};

use crate::{
    migrations::{DatabaseMigrations, Migration},
    persistence::PersistenceError,
};

pub(crate) const MIGRATIONS: DatabaseMigrations = DatabaseMigrations {
    name: "creation",
    current: 2,
    steps: &[Migration {
        from: 1,
        apply: agent_sessions,
    }],
};

fn agent_sessions(transaction: &Transaction<'_>) -> Result<(), PersistenceError> {
    transaction
        .execute_batch(
            "ALTER TABLE agent_chat RENAME TO agent_chat_v1;
         CREATE TABLE agent_chat (
             creation_order INTEGER PRIMARY KEY AUTOINCREMENT,
             id TEXT NOT NULL UNIQUE,
             title TEXT NOT NULL,
             created_at INTEGER NOT NULL,
             snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
             history_json TEXT NOT NULL CHECK (json_valid(history_json)),
             resource_edits_json TEXT NOT NULL CHECK (json_valid(resource_edits_json))
         );
         CREATE TABLE agent_selection (
             id INTEGER PRIMARY KEY CHECK (id=1),
             session_id TEXT REFERENCES agent_chat(id) ON DELETE SET NULL
         );",
        )
        .map_err(|error| {
            PersistenceError::failure("create assistant conversation schema", error)
        })?;
    let snapshot: Option<String> = transaction
        .query_row(
            "SELECT snapshot_json FROM agent_chat_v1 WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| {
            PersistenceError::failure("read previous assistant conversation", error)
        })?;
    if let Some(snapshot) = snapshot {
        let id = uuid::Uuid::new_v4().to_string();
        // Inspect only the known message fields; the original transcript and undo JSON stay intact.
        let value: serde_json::Value = crate::persistence::decode(&snapshot)?;
        let title: String = value
            .get("messages")
            .and_then(serde_json::Value::as_array)
            .and_then(|messages| {
                messages.iter().find(|message| {
                    message.get("role").and_then(serde_json::Value::as_str) == Some("user")
                })
            })
            .and_then(|message| message.get("content"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .trim()
            .chars()
            .take(80)
            .collect();
        transaction.execute(
            "INSERT INTO agent_chat(id,title,created_at,snapshot_json,history_json,resource_edits_json)
             SELECT ?1,?2,unixepoch()*1000,snapshot_json,history_json,resource_edits_json FROM agent_chat_v1 WHERE id=1", params![id,title],
        ).map_err(|error| PersistenceError::failure("upgrade retained assistant conversation", error))?;
        transaction
            .execute(
                "INSERT INTO agent_selection(id,session_id) VALUES(1,?1)",
                [&id],
            )
            .map_err(|error| {
                PersistenceError::failure("retain selected assistant conversation", error)
            })?;
        transaction
            .execute(
                "UPDATE media_references SET owner_id=?1 WHERE owner_kind='agent' AND owner_id='1'",
                [&id],
            )
            .map_err(|error| {
                PersistenceError::failure("upgrade assistant media ownership", error)
            })?;
    }
    transaction
        .execute_batch("DROP TABLE agent_chat_v1;")
        .map_err(|error| {
            PersistenceError::failure("finish assistant conversation upgrade", error)
        })?;
    Ok(())
}

#[cfg(test)]
mod tests;

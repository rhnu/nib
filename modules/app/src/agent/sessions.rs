//! Bounded retained conversations and the selected conversation identity.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension as _, params};

use super::{
    AgentSession,
    storage::{StoredChat, read_on},
};
use crate::persistence::{PersistenceError, SqliteDatabase, encode};

const MAX_SESSIONS: i64 = 10;

impl SqliteDatabase {
    pub(crate) fn agent_sessions(&self) -> Result<Vec<AgentSession>, PersistenceError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT id,title,created_at FROM agent_chat ORDER BY creation_order DESC")
            .map_err(|error| PersistenceError::failure("prepare assistant conversations", error))?;
        statement
            .query_map([], |row| {
                Ok(AgentSession {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })
            .map_err(|error| PersistenceError::failure("query assistant conversations", error))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| PersistenceError::failure("read assistant conversations", error))
    }

    pub(crate) fn new_agent_session(&self) -> Result<StoredChat, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin new assistant conversation", error)
        })?;
        let current = current_on(&transaction)?;
        let chat = if current.snapshot.messages.is_empty() && current.edits.is_empty() {
            current
        } else {
            let oldest: Option<String> = transaction.query_row(
                "SELECT id FROM agent_chat WHERE (SELECT COUNT(*) FROM agent_chat)>=?1 ORDER BY creation_order LIMIT 1",
                [MAX_SESSIONS], |row| row.get(0),
            ).optional().map_err(|error| PersistenceError::failure("find oldest assistant conversation", error))?;
            if let Some(id) = oldest {
                remove_on(&transaction, &id)?;
            }
            create_on(&transaction)?
        };
        transaction.commit().map_err(|error| {
            PersistenceError::failure("commit new assistant conversation", error)
        })?;
        Ok(chat)
    }

    pub(crate) fn select_agent_session(&self, id: &str) -> Result<StoredChat, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin assistant conversation selection", error)
        })?;
        let previous = current_on(&transaction)?;
        let mut chat = read_on(&transaction, id)?;
        if previous.id != chat.id {
            disable_undo_on(&transaction, &mut chat)?;
        }
        select_on(&transaction, id)?;
        transaction.commit().map_err(|error| {
            PersistenceError::failure("commit assistant conversation selection", error)
        })?;
        Ok(chat)
    }

    pub(crate) fn delete_agent_session(&self, id: &str) -> Result<StoredChat, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin assistant conversation deletion", error)
        })?;
        let previous = current_on(&transaction)?;
        read_on(&transaction, id)?;
        remove_on(&transaction, id)?;
        let mut chat = current_on(&transaction)?;
        if previous.id != chat.id {
            disable_undo_on(&transaction, &mut chat)?;
        }
        transaction.commit().map_err(|error| {
            PersistenceError::failure("commit assistant conversation deletion", error)
        })?;
        Ok(chat)
    }
}

/// Selection and revocation of an old undo affordance form a single durable change.
fn disable_undo_on(connection: &Connection, chat: &mut StoredChat) -> Result<(), PersistenceError> {
    chat.snapshot.resources_undo_available = false;
    connection
        .execute(
            "UPDATE agent_chat SET snapshot_json=?2 WHERE id=?1",
            params![chat.id, encode(&chat.snapshot)?],
        )
        .map_err(|error| {
            PersistenceError::failure("disable historical assistant resource undo", error)
        })?;
    Ok(())
}

pub(super) fn current_on(connection: &Connection) -> Result<StoredChat, PersistenceError> {
    let id: Option<String> = connection
        .query_row(
            "SELECT session_id FROM agent_selection WHERE id=1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| PersistenceError::failure("read selected assistant conversation", error))?
        .flatten();
    if let Some(id) = id {
        return read_on(connection, &id);
    }
    let newest: Option<String> = connection
        .query_row(
            "SELECT id FROM agent_chat ORDER BY creation_order DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| PersistenceError::failure("find latest assistant conversation", error))?;
    if let Some(id) = newest {
        select_on(connection, &id)?;
        read_on(connection, &id)
    } else {
        create_on(connection)
    }
}

fn select_on(connection: &Connection, id: &str) -> Result<(), PersistenceError> {
    connection.execute(
        "INSERT INTO agent_selection(id,session_id) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id", [id],
    ).map_err(|error| PersistenceError::failure("select assistant conversation", error))?;
    Ok(())
}

fn create_on(connection: &Connection) -> Result<StoredChat, PersistenceError> {
    let id = uuid::Uuid::new_v4().to_string();
    let mut chat = StoredChat {
        id,
        ..StoredChat::default()
    };
    chat.snapshot.session_id.clone_from(&chat.id);
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| {
            PersistenceError::failure("read assistant conversation creation time", error)
        })?;
    let created_at = i64::try_from(elapsed.as_millis()).map_err(|error| {
        PersistenceError::failure("represent assistant conversation creation time", error)
    })?;
    connection.execute(
        "INSERT INTO agent_chat(id,title,created_at,snapshot_json,history_json,resource_edits_json) VALUES(?1,'',?2,?3,?4,?5)",
        params![chat.id, created_at, encode(&chat.snapshot)?, encode(&chat.history)?, encode(&chat.edits)?],
    ).map_err(|error| PersistenceError::failure("create assistant conversation", error))?;
    select_on(connection, &chat.id)?;
    Ok(chat)
}

fn remove_on(connection: &Connection, id: &str) -> Result<(), PersistenceError> {
    crate::media::references::remove_owner_on(connection, "agent", id)?;
    connection
        .execute("DELETE FROM agent_chat WHERE id=?1", [id])
        .map_err(|error| PersistenceError::failure("delete assistant conversation", error))?;
    Ok(())
}

#[cfg(test)]
mod tests;

//! Domain-owned assistant connection metadata and retained conversation storage.

use rusqlite::{Connection, OptionalExtension as _, params};
use serde::{Deserialize, Serialize};

use super::{AgentConnectionConfig, AgentSnapshot};
use crate::{
    persistence::{PersistenceError, SqliteDatabase, decode, encode},
    prompt::Resource,
};

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct ConnectionMetadata {
    pub config: AgentConnectionConfig,
    pub secret_id: String,
}

/// Only explicit resource definitions are retained for atomic undo, never arbitrary JSON paths.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct ResourceEdit {
    pub before: Option<Resource>,
    pub after: Resource,
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub(crate) struct StoredChat {
    pub id: String,
    pub snapshot: AgentSnapshot,
    // Rig's transcript stays native and is never exposed as a provider payload over IPC.
    pub history: serde_json::Value,
    pub edits: Vec<ResourceEdit>,
}

impl SqliteDatabase {
    pub(crate) fn agent_chat(&self) -> Result<StoredChat, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin assistant conversation read", error)
        })?;
        let chat = super::sessions::current_on(&transaction)?;
        transaction.commit().map_err(|error| {
            PersistenceError::failure("commit assistant conversation read", error)
        })?;
        Ok(chat)
    }

    pub(crate) fn save_agent_chat(&self, chat: &StoredChat) -> Result<(), PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin assistant conversation write", error)
        })?;
        ensure_selected_on(&transaction, &chat.id)?;
        transaction.execute("UPDATE agent_chat SET snapshot_json=?2,history_json=?3,resource_edits_json=?4,title=?5 WHERE id=?1", params![chat.id,encode(&chat.snapshot)?,encode(&chat.history)?,encode(&chat.edits)?, title(&chat.snapshot)])
            .map_err(|error| PersistenceError::failure("save assistant conversation", error))?;
        crate::media::references::sync_agent_on(
            &transaction,
            &chat.id,
            &chat.snapshot,
            &chat.edits,
        )?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit assistant conversation", error))?;
        Ok(())
    }
}

pub(super) fn title(snapshot: &AgentSnapshot) -> String {
    snapshot
        .messages
        .iter()
        .find(|message| message.role == "user")
        .map_or_else(String::new, |message| {
            message.content.trim().chars().take(80).collect()
        })
}

pub(crate) fn ensure_selected_on(
    connection: &Connection,
    id: &str,
) -> Result<(), PersistenceError> {
    let selected: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM agent_selection WHERE id=1 AND session_id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(|error| {
            PersistenceError::failure("check selected assistant conversation", error)
        })?;
    if !selected {
        return Err(PersistenceError::Conflict {
            kind: "assistant conversation",
            id: id.to_owned(),
        });
    }
    Ok(())
}

pub(super) fn read_on(connection: &Connection, id: &str) -> Result<StoredChat, PersistenceError> {
    let values: Option<(String, String, String)> = connection
        .query_row(
            "SELECT snapshot_json,history_json,resource_edits_json FROM agent_chat WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| PersistenceError::failure("read assistant conversation", error))?;
    let (snapshot, history, edits) = values.ok_or_else(|| PersistenceError::NotFound {
        kind: "assistant conversation",
        id: id.to_owned(),
    })?;
    let mut snapshot: AgentSnapshot = decode(&snapshot)?;
    id.clone_into(&mut snapshot.session_id);
    Ok(StoredChat {
        id: id.to_owned(),
        snapshot,
        history: decode(&history)?,
        edits: decode(&edits)?,
    })
}

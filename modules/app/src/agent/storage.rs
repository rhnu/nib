//! Domain-owned assistant connection metadata and retained conversation storage.

use rusqlite::{OptionalExtension as _, params};
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
    pub snapshot: AgentSnapshot,
    // Rig's transcript stays native and is never exposed as a provider payload over IPC.
    pub history: serde_json::Value,
    pub edits: Vec<ResourceEdit>,
}

impl SqliteDatabase {
    pub(crate) fn agent_chat(&self) -> Result<StoredChat, PersistenceError> {
        let values: Option<(String, String, String)> = self
            .connection()?
            .query_row(
                "SELECT snapshot_json,history_json,resource_edits_json FROM agent_chat WHERE id=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|error| PersistenceError::failure("read assistant conversation", error))?;
        values.map_or_else(
            || Ok(StoredChat::default()),
            |(snapshot, history, edits)| {
                Ok(StoredChat {
                    snapshot: decode(&snapshot)?,
                    history: decode(&history)?,
                    edits: decode(&edits)?,
                })
            },
        )
    }

    pub(crate) fn save_agent_chat(&self, chat: &StoredChat) -> Result<(), PersistenceError> {
        self.connection()?.execute("INSERT INTO agent_chat(id,snapshot_json,history_json,resource_edits_json) VALUES(1,?1,?2,?3) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json,history_json=excluded.history_json,resource_edits_json=excluded.resource_edits_json", params![encode(&chat.snapshot)?,encode(&chat.history)?,encode(&chat.edits)?])
            .map_err(|error| PersistenceError::failure("save assistant conversation", error))?;
        Ok(())
    }
}

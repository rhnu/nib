use rusqlite::{OptionalExtension as _, params};

use super::{Draft, DraftStore, DraftSummary, validate_draft};
use crate::persistence::{
    PersistenceError, SqliteDatabase, decode, encode, next_revision, write_miss,
};

impl DraftStore for SqliteDatabase {
    fn get_draft(&self, id: &str) -> Result<Option<Draft>, PersistenceError> {
        let connection = self.connection()?;
        let row = connection.query_row(
            "SELECT id, revision, name, composition, presets, settings FROM drafts WHERE id = ?1",
            [id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?)),
        ).optional().map_err(|error| PersistenceError::failure("read a draft", error))?;
        row.map(|(id, revision, name, composition, presets, settings)| {
            Ok(Draft {
                id,
                revision,
                name,
                composition: decode(&composition)?,
                presets: decode(&presets)?,
                settings: decode(&settings)?,
            })
        })
        .transpose()
    }

    fn list_drafts(&self) -> Result<Vec<DraftSummary>, PersistenceError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT id, revision, name FROM drafts ORDER BY updated_at DESC, rowid DESC")
            .map_err(|error| PersistenceError::failure("prepare the draft list", error))?;
        statement
            .query_map([], |row| {
                Ok(DraftSummary {
                    id: row.get(0)?,
                    revision: row.get(1)?,
                    name: row.get(2)?,
                })
            })
            .map_err(|error| PersistenceError::failure("list drafts", error))?
            .collect::<Result<_, _>>()
            .map_err(|error| PersistenceError::failure("read the draft list", error))
    }

    fn save_draft(&self, draft: &Draft) -> Result<Draft, PersistenceError> {
        validate_draft(draft).map_err(|error| PersistenceError::InvalidData {
            message: error.to_string(),
        })?;
        let revision = next_revision(draft.revision)?;
        let composition = encode(&draft.composition)?;
        let presets = encode(&draft.presets)?;
        let settings = encode(&draft.settings)?;
        let connection = self.connection()?;
        let count = if draft.revision == 0 {
            connection.execute(
                "INSERT INTO drafts(id, revision, name, composition, presets, settings) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(id) DO NOTHING",
                params![draft.id, revision, draft.name, composition, presets, settings],
            )
        } else {
            connection.execute(
                "UPDATE drafts SET revision = ?2, name = ?3, composition = ?4, presets = ?5, settings = ?6, updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = ?1 AND revision = ?7",
                params![draft.id, revision, draft.name, composition, presets, settings, draft.revision],
            )
        }.map_err(|error| PersistenceError::failure("save a draft", error))?;
        if count == 0 {
            return Err(write_miss(&connection, "drafts", "draft", &draft.id));
        }
        Ok(Draft {
            revision,
            ..draft.clone()
        })
    }

    fn delete_draft(&self, id: &str, revision: u32) -> Result<(), PersistenceError> {
        let connection = self.connection()?;
        let count = connection
            .execute(
                "DELETE FROM drafts WHERE id = ?1 AND revision = ?2",
                params![id, revision],
            )
            .map_err(|error| PersistenceError::failure("delete a draft", error))?;
        if count == 0 {
            return Err(write_miss(&connection, "drafts", "draft", id));
        }
        Ok(())
    }
}

use rusqlite::{OptionalExtension as _, params};

use super::{Draft, DraftStore, validate_draft};
use crate::persistence::{PersistenceError, SqliteDatabase, decode, encode, next_revision};

impl DraftStore for SqliteDatabase {
    fn get_draft(&self) -> Result<Draft, PersistenceError> {
        let connection = self.connection()?;
        let row = connection.query_row(
            "SELECT revision, composition, presets, settings FROM current_creation WHERE id = 1",
            [],
            |row| Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?)),
        ).optional().map_err(|error| PersistenceError::failure("read the current creation", error))?;
        row.map_or_else(
            || Ok(Draft::default()),
            |(revision, composition, presets, settings)| {
                Ok(Draft {
                    revision,
                    composition: decode(&composition)?,
                    presets: decode(&presets)?,
                    settings: decode(&settings)?,
                })
            },
        )
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
                "INSERT INTO current_creation(id, revision, composition, presets, settings) VALUES (1, ?1, ?2, ?3, ?4) ON CONFLICT(id) DO NOTHING",
                params![revision, composition, presets, settings],
            )
        } else {
            connection.execute(
                "UPDATE current_creation SET revision = ?1, composition = ?2, presets = ?3, settings = ?4 WHERE id = 1 AND revision = ?5",
                params![revision, composition, presets, settings, draft.revision],
            )
        }.map_err(|error| PersistenceError::failure("save the current creation", error))?;
        if count == 0 {
            return Err(PersistenceError::Conflict {
                kind: "current creation",
                id: "1".to_owned(),
            });
        }
        Ok(Draft {
            revision,
            ..draft.clone()
        })
    }
}

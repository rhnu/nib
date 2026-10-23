use rusqlite::{OptionalExtension as _, params};

use super::{Draft, DraftStore, validate_draft};
use crate::persistence::{PersistenceError, SqliteDatabase, decode, encode, next_revision};

impl DraftStore for SqliteDatabase {
    fn get_draft(&self) -> Result<Draft, PersistenceError> {
        let connection = self.connection()?;
        let row = connection.query_row(
            "SELECT revision, composition, presets, settings, characters, inputs, mask_editor, vibe_encoder FROM current_creation WHERE id = 1",
            [],
            |row| Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?, row.get::<_, String>(6)?, row.get::<_, String>(7)?)),
        ).optional().map_err(|error| PersistenceError::failure("read the current creation", error))?;
        row.map_or_else(
            || Ok(Draft::default()),
            |(
                revision,
                composition,
                presets,
                settings,
                characters,
                inputs,
                mask_editor,
                vibe_encoder,
            )| {
                Ok(Draft {
                    revision,
                    composition: decode(&composition)?,
                    presets: decode(&presets)?,
                    settings: decode(&settings)?,
                    characters: decode(&characters)?,
                    inputs: decode(&inputs)?,
                    mask_editor: decode(&mask_editor)?,
                    vibe_encoder: decode(&vibe_encoder)?,
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
        let characters = encode(&draft.characters)?;
        let inputs = encode(&draft.inputs)?;
        let mask_editor = encode(&draft.mask_editor)?;
        let vibe_encoder = encode(&draft.vibe_encoder)?;
        let connection = self.connection()?;
        let count = if draft.revision == 0 {
            connection.execute(
                "INSERT INTO current_creation(id, revision, composition, presets, settings, characters, inputs, mask_editor, vibe_encoder) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(id) DO NOTHING",
                params![revision, composition, presets, settings, characters, inputs, mask_editor, vibe_encoder],
            )
        } else {
            connection.execute(
                "UPDATE current_creation SET revision = ?1, composition = ?2, presets = ?3, settings = ?4, characters = ?5, inputs = ?6, mask_editor = ?7, vibe_encoder = ?8 WHERE id = 1 AND revision = ?9",
                params![revision, composition, presets, settings, characters, inputs, mask_editor, vibe_encoder, draft.revision],
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

use rusqlite::{OptionalExtension as _, params};

use super::{Draft, DraftSaveReceipt, DraftStore, validate_draft};
use crate::persistence::{PersistenceError, SqliteDatabase, decode, encode, next_revision};

impl DraftStore for SqliteDatabase {
    fn get_draft(&self) -> Result<Draft, PersistenceError> {
        let connection = self.connection()?;
        let row = connection.query_row(
            "SELECT revision, composition, presets, settings, characters, inputs, mask_editor, vibe_encoder, director, png_text_editor, active_page, prompt_editor FROM current_creation WHERE id = 1",
            [],
            |row| Ok((row.get::<_, u32>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?, row.get::<_, String>(6)?, row.get::<_, String>(7)?, row.get::<_, String>(8)?, row.get::<_, String>(9)?, row.get::<_, String>(10)?, row.get::<_, String>(11)?)),
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
                director,
                png_text_editor,
                active_page,
                prompt_editor,
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
                    director: decode(&director)?,
                    png_text_editor: decode(&png_text_editor)?,
                    active_page: decode(&active_page)?,
                    prompt_editor: decode(&prompt_editor)?,
                })
            },
        )
    }

    fn save_draft(&self, draft: &Draft) -> Result<DraftSaveReceipt, PersistenceError> {
        validate_draft(draft).map_err(|error| PersistenceError::InvalidData {
            message: crate::api::UserMessage::Validation {
                field: error.field,
                message: Box::new(error.message),
            },
        })?;
        let revision = next_revision(draft.revision)?;
        let composition = encode(&draft.composition)?;
        let presets = encode(&draft.presets)?;
        let settings = encode(&draft.settings)?;
        let characters = encode(&draft.characters)?;
        let inputs = encode(&draft.inputs)?;
        let mask_editor = encode(&draft.mask_editor)?;
        let vibe_encoder = encode(&draft.vibe_encoder)?;
        let director = encode(&draft.director)?;
        let png_text_editor = encode(&draft.png_text_editor)?;
        let active_page = encode(&draft.active_page)?;
        let prompt_editor = encode(&draft.prompt_editor)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin saving the current creation", error)
        })?;
        let count = if draft.revision == 0 {
            transaction.execute(
                "INSERT INTO current_creation(id, revision, composition, presets, settings, characters, inputs, mask_editor, vibe_encoder, director, png_text_editor, active_page, prompt_editor) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) ON CONFLICT(id) DO NOTHING",
                params![revision, composition, presets, settings, characters, inputs, mask_editor, vibe_encoder, director, png_text_editor, active_page, prompt_editor],
            )
        } else {
            transaction.execute(
                "UPDATE current_creation SET revision = ?1, composition = ?2, presets = ?3, settings = ?4, characters = ?5, inputs = ?6, mask_editor = ?7, vibe_encoder = ?8, director = ?9, png_text_editor = ?10, active_page = ?11, prompt_editor = ?12 WHERE id = 1 AND revision = ?13",
                params![revision, composition, presets, settings, characters, inputs, mask_editor, vibe_encoder, director, png_text_editor, active_page, prompt_editor, draft.revision],
            )
        }.map_err(|error| PersistenceError::failure("save the current creation", error))?;
        if count == 0 {
            return Err(PersistenceError::Conflict {
                kind: "current creation",
                id: "1".to_owned(),
            });
        }
        crate::media::references::sync_creation_on(&transaction, draft)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit the current creation", error))?;
        Ok(DraftSaveReceipt { revision })
    }
}

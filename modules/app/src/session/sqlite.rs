use rusqlite::{OptionalExtension as _, params};

use super::{Draft, DraftStore, validate_draft};
use crate::persistence::{PersistenceError, SqliteDatabase, decode, encode};

impl DraftStore for SqliteDatabase {
    fn get_draft(&self) -> Result<Draft, PersistenceError> {
        let connection = self.connection()?;
        let row = connection.query_row(
            "SELECT composition, presets, settings, characters, inputs, mask_editor, vibe_encoder, director, png_text_editor, active_page, prompt_editor FROM current_creation WHERE id = 1",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?, row.get::<_, String>(5)?, row.get::<_, String>(6)?, row.get::<_, String>(7)?, row.get::<_, String>(8)?, row.get::<_, String>(9)?, row.get::<_, String>(10)?)),
        ).optional().map_err(|error| PersistenceError::failure("read the current creation", error))?;
        row.map_or_else(
            || Ok(Draft::default()),
            |(
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

    fn save_draft(&self, draft: &Draft) -> Result<(), PersistenceError> {
        validate_draft(draft).map_err(|error| PersistenceError::InvalidData {
            message: crate::api::UserMessage::Validation {
                field: error.field,
                message: Box::new(error.message),
            },
        })?;
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
        transaction.execute(
            "INSERT INTO current_creation(id, composition, presets, settings, characters, inputs, mask_editor, vibe_encoder, director, png_text_editor, active_page, prompt_editor) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(id) DO UPDATE SET composition=excluded.composition, presets=excluded.presets, settings=excluded.settings, characters=excluded.characters, inputs=excluded.inputs, mask_editor=excluded.mask_editor, vibe_encoder=excluded.vibe_encoder, director=excluded.director, png_text_editor=excluded.png_text_editor, active_page=excluded.active_page, prompt_editor=excluded.prompt_editor",
            params![composition, presets, settings, characters, inputs, mask_editor, vibe_encoder, director, png_text_editor, active_page, prompt_editor],
        ).map_err(|error| PersistenceError::failure("save the current creation", error))?;
        crate::media::references::sync_creation_on(&transaction, draft)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit the current creation", error))?;
        Ok(())
    }
}

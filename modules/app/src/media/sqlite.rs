use rusqlite::{OptionalExtension, params};

use super::{GenerationResult, RetainedImage};
use crate::{
    jobs::decode_submission,
    persistence::{PersistenceError, SqliteDatabase, decode, encode},
};

impl SqliteDatabase {
    pub(super) fn read_results(
        &self,
        id: Option<&str>,
    ) -> Result<Vec<RetainedImage>, PersistenceError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT r.id, r.job_id, r.sample_index, r.seed, r.created_at, r.format, r.byte_length, j.submission FROM generation_results r JOIN jobs j ON j.id = r.job_id WHERE (?1 IS NULL OR r.id = ?1) ORDER BY r.created_at DESC, r.sample_index",
        ).map_err(|error| PersistenceError::failure("prepare retained generation results", error))?;
        let rows = statement
            .query_map([id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, u32>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, String>(7)?,
                ))
            })
            .map_err(|error| {
                PersistenceError::failure("read retained generation results", error)
            })?;
        rows.map(|row| {
            let (id, job_id, sample_index, seed, created_at, format, byte_length, submission) = row
                .map_err(|error| {
                    PersistenceError::failure("decode a retained generation result", error)
                })?;
            let format: novelai_bridge::ImageMediaFormat = decode(&format)?;
            Ok(RetainedImage {
                result: GenerationResult {
                    id,
                    job_id: job_id.to_string(),
                    sample_index,
                    seed,
                    created_at,
                    mime_type: format.mime_type().to_owned(),
                    available: false,
                    submission: decode_submission(&submission)?,
                },
                format,
                byte_length,
            })
        })
        .collect()
    }

    pub(super) fn commit_results(
        &self,
        job_id: &str,
        images: &[RetainedImage],
    ) -> Result<(), PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin retaining final generation results", error)
        })?;
        let running: Option<bool> = transaction
            .query_row(
                "SELECT status = 'running' FROM jobs WHERE id = ?1",
                [job_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| {
                PersistenceError::failure("check generation state before retaining results", error)
            })?;
        if running != Some(true) {
            return Ok(());
        }
        for image in images {
            transaction.execute("INSERT INTO generation_results (id, job_id, sample_index, seed, created_at, format, byte_length) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![image.result.id, job_id, image.result.sample_index, image.result.seed, image.result.created_at, encode(&image.format)?, image.byte_length])
                .map_err(|error| PersistenceError::failure("retain a final generation result", error))?;
        }
        transaction.execute("UPDATE jobs SET status = 'completed', finished_at = ?2, error = NULL WHERE id = ?1", params![job_id, crate::jobs::timestamp()?])
            .map_err(|error| PersistenceError::failure("complete a generation job", error))?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit final generation results", error))
    }
}

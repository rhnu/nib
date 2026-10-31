use rusqlite::{OptionalExtension as _, params};

use super::{ImageSafety, SafetyStatus, ScanOutcome};
use crate::{
    media::BlobId,
    persistence::{PersistenceError, SqliteDatabase, decode, encode},
};

impl SqliteDatabase {
    pub(crate) fn image_safety(
        &self,
        asset_id: &str,
        blob_id: &BlobId,
    ) -> Result<ImageSafety, PersistenceError> {
        let stored: Option<(String, Option<String>, Option<String>)> = self
            .connection()?
            .query_row(
                "SELECT status, reason, assessment FROM image_safety WHERE blob_id=?1",
                [blob_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|error| PersistenceError::failure("read image safety evidence", error))?;
        let (status, reason, assessment) = match stored {
            Some((status, reason, assessment)) => (
                decode(&status)?,
                reason,
                assessment.as_deref().map(decode).transpose()?,
            ),
            None => (SafetyStatus::Unknown, Some("notScanned".to_owned()), None),
        };
        Ok(ImageSafety {
            asset_id: asset_id.to_owned(),
            status,
            reason,
            assessment,
        })
    }

    pub(crate) fn save_image_safety(
        &self,
        blob_id: &BlobId,
        outcome: &ScanOutcome,
    ) -> Result<(), PersistenceError> {
        self.connection()?.execute(
            "INSERT INTO image_safety(blob_id,status,reason,assessment) VALUES(?1,?2,?3,?4) ON CONFLICT(blob_id) DO UPDATE SET status=CASE WHEN excluded.assessment IS NULL AND image_safety.assessment IS NOT NULL THEN image_safety.status ELSE excluded.status END,reason=excluded.reason,assessment=COALESCE(excluded.assessment,image_safety.assessment)",
            params![blob_id, encode(&outcome.status)?, outcome.reason, outcome.assessment.as_ref().map(encode).transpose()?],
        ).map_err(|error| PersistenceError::failure("save image safety evidence", error))?;
        Ok(())
    }

    #[cfg(feature = "native")]
    pub(crate) fn unknown_image_ids(&self) -> Result<Vec<String>, PersistenceError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("SELECT MIN(a.id) FROM generation_results r JOIN media_assets a ON a.id=r.asset_id LEFT JOIN image_safety s ON s.blob_id=a.blob_id WHERE a.kind='image' AND (s.blob_id IS NULL OR s.status='\"unknown\"') GROUP BY a.blob_id ORDER BY MIN(a.created_at) DESC")
            .map_err(|error| PersistenceError::failure("prepare unknown image safety query", error))?;
        let rows = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| PersistenceError::failure("query unknown image safety", error))?;
        rows.map(|row| {
            row.map_err(|error| PersistenceError::failure("read unknown image identity", error))
        })
        .collect()
    }
}

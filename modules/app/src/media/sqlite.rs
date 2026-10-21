use rusqlite::{Connection, OptionalExtension, params};

use super::{AssetKind, GenerationResult, MediaAsset, RetainedOutput};
use crate::{
    jobs::decode_submission,
    persistence::{PersistenceError, SqliteDatabase, decode, encode},
};

struct AssetRow {
    id: String,
    kind: String,
    mime_type: String,
    byte_length: i64,
    width: Option<u32>,
    height: Option<u32>,
    created_at: i64,
    source: String,
}

fn read_asset_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AssetRow> {
    Ok(AssetRow {
        id: row.get(0)?,
        kind: row.get(1)?,
        mime_type: row.get(2)?,
        byte_length: row.get(3)?,
        width: row.get(4)?,
        height: row.get(5)?,
        created_at: row.get(6)?,
        source: row.get(7)?,
    })
}

impl AssetRow {
    fn decode(self) -> Result<MediaAsset, PersistenceError> {
        Ok(MediaAsset {
            id: self.id,
            kind: match self.kind.as_str() {
                "image" => AssetKind::Image,
                "vibe" => AssetKind::Vibe,
                _ => {
                    return Err(PersistenceError::InvalidData {
                        message: "未知媒体类型。".to_owned(),
                    });
                },
            },
            mime_type: self.mime_type,
            byte_length: self.byte_length,
            width: self.width,
            height: self.height,
            created_at: self.created_at,
            source: decode(&self.source)?,
            available: false,
        })
    }
}

fn insert_asset(connection: &Connection, asset: &MediaAsset) -> Result<(), PersistenceError> {
    let kind = match asset.kind {
        AssetKind::Image => "image",
        AssetKind::Vibe => "vibe",
    };
    connection.execute("INSERT INTO media_assets (id, kind, mime_type, byte_length, width, height, created_at, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![asset.id, kind, asset.mime_type, asset.byte_length, asset.width, asset.height, asset.created_at, encode(&asset.source)?])
        .map_err(|error| PersistenceError::failure("retain immutable media metadata", error))?;
    Ok(())
}

impl SqliteDatabase {
    pub(super) fn read_assets(
        &self,
        id: Option<&str>,
    ) -> Result<Vec<MediaAsset>, PersistenceError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("SELECT id, kind, mime_type, byte_length, width, height, created_at, source FROM media_assets WHERE (?1 IS NULL OR id = ?1) ORDER BY created_at DESC, id")
            .map_err(|error| PersistenceError::failure("prepare immutable media records", error))?;
        let rows = statement
            .query_map([id], read_asset_row)
            .map_err(|error| PersistenceError::failure("query immutable media records", error))?;
        rows.map(|row| {
            row.map_err(|error| PersistenceError::failure("read immutable media metadata", error))?
                .decode()
        })
        .collect()
    }

    pub(super) fn insert_asset(&self, asset: &MediaAsset) -> Result<(), PersistenceError> {
        let connection = self.connection()?;
        insert_asset(&connection, asset)
    }

    pub(super) fn insert_assets(&self, assets: &[MediaAsset]) -> Result<(), PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin retaining embedded Vibe assets", error)
        })?;
        for asset in assets {
            insert_asset(&transaction, asset)?;
        }
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit embedded Vibe assets", error))
    }

    pub(super) fn read_results(
        &self,
        id: Option<&str>,
    ) -> Result<Vec<RetainedOutput>, PersistenceError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT a.id, a.kind, a.mime_type, a.byte_length, a.width, a.height, a.created_at, a.source, r.id, r.job_id, r.sample_index, r.seed, r.created_at, j.submission FROM generation_results r JOIN jobs j ON j.id = r.job_id JOIN media_assets a ON a.id = r.asset_id WHERE (?1 IS NULL OR r.id = ?1) ORDER BY r.created_at DESC, r.sample_index",
        ).map_err(|error| PersistenceError::failure("prepare retained operation outputs", error))?;
        let rows = statement
            .query_map([id], |row| {
                Ok((
                    read_asset_row(row)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, u32>(10)?,
                    row.get::<_, Option<i64>>(11)?,
                    row.get::<_, i64>(12)?,
                    row.get::<_, String>(13)?,
                ))
            })
            .map_err(|error| {
                PersistenceError::failure("query retained operation outputs", error)
            })?;
        rows.map(|row| {
            let (asset, id, job_id, sample_index, seed, created_at, submission) =
                row.map_err(|error| {
                    PersistenceError::failure("read retained operation output", error)
                })?;
            let asset = asset.decode()?;
            Ok(RetainedOutput {
                result: GenerationResult {
                    id,
                    job_id: job_id.to_string(),
                    sample_index,
                    asset_id: asset.id.clone(),
                    kind: asset.kind,
                    seed,
                    created_at,
                    mime_type: asset.mime_type.clone(),
                    available: false,
                    submission: decode_submission(&submission)?,
                },
                asset,
            })
        })
        .collect()
    }

    pub(super) fn commit_results(
        &self,
        job_id: &str,
        outputs: &[RetainedOutput],
    ) -> Result<(), PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin retaining operation outputs", error)
        })?;
        let running: Option<bool> = transaction
            .query_row(
                "SELECT status = 'running' FROM jobs WHERE id = ?1",
                [job_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| {
                PersistenceError::failure("check task state before retaining outputs", error)
            })?;
        if running != Some(true) {
            return Ok(());
        }
        for output in outputs {
            insert_asset(&transaction, &output.asset)?;
            transaction.execute("INSERT INTO generation_results (id, job_id, sample_index, asset_id, seed, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![output.result.id, job_id, output.result.sample_index, output.asset.id, output.result.seed, output.result.created_at])
                .map_err(|error| PersistenceError::failure("retain a final operation output", error))?;
        }
        transaction.execute("UPDATE jobs SET status = 'completed', finished_at = ?2, error = NULL WHERE id = ?1", params![job_id, crate::jobs::timestamp()?])
            .map_err(|error| PersistenceError::failure("complete an operation task", error))?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit final operation outputs", error))
    }
}

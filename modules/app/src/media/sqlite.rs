use rusqlite::{Connection, OptionalExtension, params};

use super::{
    AssetKind, BlobId, GenerationResult, ListedOutput, MediaAsset, ResultQuery, ResultSummary,
    RetainedOutput,
};
use crate::{
    api::UserMessage,
    jobs::{OPERATION_SUMMARY_SQL, decode_operation_summary, decode_submission},
    persistence::{PersistenceError, SqliteDatabase, decode, encode},
};

struct AssetRow {
    id: String,
    blob_id: BlobId,
    owner_resource_id: Option<String>,
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
        blob_id: row.get("blob_id")?,
        owner_resource_id: row.get("owner_resource_id")?,
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
        super::content::AssetId::parse(&self.id)?;
        Ok(MediaAsset {
            id: self.id,
            blob_id: self.blob_id,
            owner_resource_id: self.owner_resource_id,
            kind: match self.kind.as_str() {
                "image" => AssetKind::Image,
                "vibe" => AssetKind::Vibe,
                "vibeDocument" => AssetKind::VibeDocument,
                _ => {
                    return Err(PersistenceError::InvalidData {
                        message: UserMessage::UnknownMediaKind,
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

pub(super) fn insert_asset(
    connection: &Connection,
    asset: &MediaAsset,
) -> Result<(), PersistenceError> {
    let kind = match asset.kind {
        AssetKind::Image => "image",
        AssetKind::Vibe => "vibe",
        AssetKind::VibeDocument => "vibeDocument",
    };
    super::content::AssetId::parse(&asset.id)?;
    connection
        .execute(
            "INSERT INTO media_blobs (id, byte_length) VALUES (?1, ?2) ON CONFLICT(id) DO NOTHING",
            params![asset.blob_id, asset.byte_length],
        )
        .map_err(|error| PersistenceError::failure("retain immutable blob metadata", error))?;
    let byte_length: i64 = connection
        .query_row(
            "SELECT byte_length FROM media_blobs WHERE id=?1",
            [&asset.blob_id],
            |row| row.get(0),
        )
        .map_err(|error| PersistenceError::failure("verify immutable blob metadata", error))?;
    if byte_length != asset.byte_length {
        return Err(PersistenceError::InvalidData {
            message: UserMessage::IncompleteMedia,
        });
    }
    connection.execute("INSERT INTO media_assets (id, blob_id, owner_resource_id, kind, mime_type, width, height, created_at, source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![asset.id, asset.blob_id, asset.owner_resource_id, kind, asset.mime_type, asset.width, asset.height, asset.created_at, encode(&asset.source)?])
        .map_err(|error| PersistenceError::failure("retain immutable media metadata", error))?;
    super::references::sync_asset_on(connection, asset)?;
    Ok(())
}

pub(super) fn read_asset_on(
    connection: &Connection,
    id: &str,
) -> Result<MediaAsset, PersistenceError> {
    super::content::AssetId::parse(id)?;
    connection.query_row("SELECT a.id,a.kind,a.mime_type,b.byte_length,a.width,a.height,a.created_at,a.source,a.blob_id,a.owner_resource_id FROM media_assets a JOIN media_blobs b ON b.id=a.blob_id WHERE a.id=?1", [id], read_asset_row)
        .optional().map_err(|error| PersistenceError::failure("read resource cover asset", error))?
        .ok_or_else(|| PersistenceError::NotFound { kind: "media asset", id: id.to_owned() })?.decode()
}

impl SqliteDatabase {
    pub(super) fn read_assets(
        &self,
        id: Option<&str>,
    ) -> Result<Vec<MediaAsset>, PersistenceError> {
        let connection = self.connection()?;
        let sql = if id.is_some() {
            "SELECT a.id, a.kind, a.mime_type, b.byte_length, a.width, a.height, a.created_at, a.source, a.blob_id, a.owner_resource_id FROM media_assets a JOIN media_blobs b ON b.id=a.blob_id WHERE a.id = ?1"
        } else {
            "SELECT a.id, a.kind, a.mime_type, b.byte_length, a.width, a.height, a.created_at, a.source, a.blob_id, a.owner_resource_id FROM media_assets a JOIN media_blobs b ON b.id=a.blob_id ORDER BY a.created_at DESC, a.id"
        };
        let mut statement = connection
            .prepare(sql)
            .map_err(|error| PersistenceError::failure("prepare immutable media records", error))?;
        let rows = statement
            .query_map(rusqlite::params_from_iter(id), read_asset_row)
            .map_err(|error| PersistenceError::failure("query immutable media records", error))?;
        rows.map(|row| {
            row.map_err(|error| PersistenceError::failure("read immutable media metadata", error))?
                .decode()
        })
        .collect()
    }

    pub(super) fn insert_asset(&self, asset: &MediaAsset) -> Result<(), PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin retaining an immutable asset", error)
        })?;
        insert_asset(&transaction, asset)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit an immutable asset", error))
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

    pub(super) fn read_result_asset(&self, id: &str) -> Result<MediaAsset, PersistenceError> {
        self.connection()?.query_row(
            "SELECT a.id, a.kind, a.mime_type, b.byte_length, a.width, a.height, a.created_at, a.source, a.blob_id, a.owner_resource_id FROM generation_results r JOIN media_assets a ON a.id = r.asset_id JOIN media_blobs b ON b.id=a.blob_id WHERE r.id = ?1",
            [id], read_asset_row,
        ).optional().map_err(|error| PersistenceError::failure("read a result's media identity", error))?
            .ok_or_else(|| PersistenceError::NotFound { kind: "result", id: id.to_owned() })?.decode()
    }

    pub(super) fn read_result(&self, id: &str) -> Result<RetainedOutput, PersistenceError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT a.id, a.kind, a.mime_type, b.byte_length, a.width, a.height, a.created_at, a.source, r.id, r.job_id, r.sample_index, r.seed, r.created_at, j.submission, r.image_source, a.blob_id, a.owner_resource_id FROM generation_results r JOIN jobs j ON j.id = r.job_id JOIN media_assets a ON a.id = r.asset_id JOIN media_blobs b ON b.id=a.blob_id WHERE r.id = ?1",
        ).map_err(|error| PersistenceError::failure("prepare retained operation outputs", error))?;
        let row = statement
            .query_row([id], |row| {
                Ok((
                    read_asset_row(row)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, u32>(10)?,
                    row.get::<_, Option<i64>>(11)?,
                    row.get::<_, i64>(12)?,
                    row.get::<_, String>(13)?,
                    row.get::<_, Option<String>>(14)?,
                ))
            })
            .optional()
            .map_err(|error| PersistenceError::failure("query retained operation outputs", error))?
            .ok_or_else(|| PersistenceError::NotFound {
                kind: "result",
                id: id.to_owned(),
            })?;
        let (asset, id, job_id, sample_index, seed, created_at, submission, image_source) = row;
        let asset = asset.decode()?;
        Ok(RetainedOutput {
            result: GenerationResult {
                id,
                job_id: job_id.to_string(),
                sample_index,
                asset_id: asset.id.clone(),
                kind: asset.kind,
                image_source: image_source.as_deref().map(decode).transpose()?,
                seed,
                created_at,
                mime_type: asset.mime_type.clone(),
                available: false,
                submission: decode_submission(&submission)?,
            },
            asset,
        })
    }

    pub(super) fn list_results(
        &self,
        query: &ResultQuery,
    ) -> Result<(Vec<ListedOutput>, Option<String>), PersistenceError> {
        if !(1..=200).contains(&query.limit) {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::ResultPageLimit,
            });
        }
        let before = query
            .before
            .as_deref()
            .map(|cursor| {
                cursor
                    .parse::<i64>()
                    .ok()
                    .filter(|value| *value > 0)
                    .ok_or_else(|| PersistenceError::InvalidData {
                        message: UserMessage::InvalidResultCursor,
                    })
            })
            .transpose()?;
        let bound = before.map_or(i64::MAX, |value| value - 1);
        let connection = self.connection()?;
        let sql = format!(
            "SELECT a.id, a.kind, a.mime_type, b.byte_length, a.width, a.height, a.created_at, a.source, r.id, r.job_id, r.sample_index, r.seed, r.created_at, r.image_source, {OPERATION_SUMMARY_SQL}, r.rowid, a.blob_id, a.owner_resource_id FROM generation_results r JOIN jobs j ON j.id = r.job_id JOIN media_assets a ON a.id = r.asset_id JOIN media_blobs b ON b.id=a.blob_id WHERE r.rowid <= ?1 AND (?3 IS NULL OR a.kind = ?3) AND (?4 IS NULL OR CAST(r.job_id AS TEXT) = ?4) ORDER BY r.rowid DESC LIMIT ?2"
        );
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| PersistenceError::failure("prepare result summaries", error))?;
        let rows = statement
            .query_map(
                params![
                    bound,
                    query.limit + 1,
                    query
                        .kind
                        .map(|kind| encode(&kind))
                        .transpose()?
                        .map(|value| value.trim_matches('"').to_owned()),
                    query.job_id
                ],
                |row| {
                    Ok((
                        read_asset_row(row)?,
                        row.get::<_, String>(8)?,
                        row.get::<_, i64>(9)?,
                        row.get::<_, u32>(10)?,
                        row.get::<_, Option<i64>>(11)?,
                        row.get::<_, i64>(12)?,
                        row.get::<_, Option<String>>(13)?,
                        row.get::<_, String>(14)?,
                        row.get::<_, i64>(15)?,
                    ))
                },
            )
            .map_err(|error| PersistenceError::failure("query result summaries", error))?;
        let mut outputs = rows
            .map(|row| {
                let (
                    asset,
                    id,
                    job_id,
                    sample_index,
                    seed,
                    created_at,
                    image_source,
                    operation,
                    cursor,
                ) =
                    row.map_err(|error| PersistenceError::failure("read a result summary", error))?;
                let asset = asset.decode()?;
                Ok((
                    ListedOutput {
                        result: ResultSummary {
                            id,
                            job_id: job_id.to_string(),
                            sample_index,
                            asset_id: asset.id.clone(),
                            kind: asset.kind,
                            image_source: image_source.as_deref().map(decode).transpose()?,
                            seed,
                            created_at,
                            mime_type: asset.mime_type.clone(),
                            available: false,
                            operation: decode_operation_summary(&operation)?,
                        },
                        asset,
                    },
                    cursor,
                ))
            })
            .collect::<Result<Vec<_>, PersistenceError>>()?;
        let next_cursor = if outputs.len() > query.limit as usize {
            outputs.pop();
            outputs.last().map(|(_, cursor)| cursor.to_string())
        } else {
            None
        };
        Ok((
            outputs.into_iter().map(|(output, _)| output).collect(),
            next_cursor,
        ))
    }

    pub(super) fn commit_results(
        &self,
        job_id: &str,
        outputs: &[RetainedOutput],
    ) -> Result<bool, PersistenceError> {
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
            return Ok(false);
        }
        for output in outputs {
            insert_asset(&transaction, &output.asset)?;
            transaction.execute("INSERT INTO generation_results (id, job_id, sample_index, asset_id, seed, created_at, image_source) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![output.result.id, job_id, output.result.sample_index, output.asset.id, output.result.seed, output.result.created_at, output.result.image_source.as_ref().map(encode).transpose()?])
                .map_err(|error| PersistenceError::failure("retain a final operation output", error))?;
            super::references::sync_result_on(&transaction, &output.result.id, &output.asset.id)?;
        }
        transaction.execute("UPDATE jobs SET status = 'completed', finished_at = ?2, error = NULL WHERE id = ?1", params![job_id, crate::jobs::timestamp()?])
            .map_err(|error| PersistenceError::failure("complete an operation task", error))?;
        transaction
            .commit()
            .map(|()| true)
            .map_err(|error| PersistenceError::failure("commit final operation outputs", error))
    }
}

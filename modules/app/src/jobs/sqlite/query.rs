//! Lightweight SQL projections and terminal-history pagination.

use rusqlite::Connection;

use super::parse_id;
use crate::{
    jobs::{JobPage, JobQuery, JobSummary, OperationSummary},
    persistence::{PersistenceError, decode, encode},
};

/// SQLite extracts only list fields; full prompts and their SDK normalization stay in details.
pub(crate) const OPERATION_SUMMARY_SQL: &str = "json_object(
    'kind', json_extract(j.submission, '$.kind'),
    'sample_count', json_extract(j.submission, '$.request.core.n_samples'),
    'asset_id', coalesce(json_extract(j.submission, '$.asset_id'), json_extract(j.submission, '$.inputs.operation.assetId')),
    'command', json_extract(j.submission, '$.command'),
    'input', json_object(
        'assetId', json_extract(j.submission, '$.asset_id'),
        'model', json_extract(j.submission, '$.model'),
        'informationExtracted', json_extract(j.submission, '$.information_extracted'),
        'maskAssetId', json_extract(j.submission, '$.mask_asset_id'),
        'cropToMask', json(CASE json_extract(j.submission, '$.crop_to_mask') WHEN 1 THEN 'true' WHEN 0 THEN 'false' ELSE 'null' END),
        'focusSeed', json_extract(j.submission, '$.focus_seed'),
        'infoExtractSeed', json_extract(j.submission, '$.info_extract_seed')
    )
)";

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum StoredOperationSummary {
    Generation {
        sample_count: u32,
        asset_id: Option<String>,
    },
    Director {
        asset_id: String,
        command: novelai_bridge::DirectorCommand,
    },
    EncodeVibe {
        input: crate::session::VibeEncodingInput,
    },
    Upscale {
        asset_id: String,
    },
}

pub(crate) fn decode_operation_summary(
    content: &str,
) -> Result<OperationSummary, PersistenceError> {
    Ok(match decode(content)? {
        StoredOperationSummary::Generation {
            sample_count,
            asset_id,
        } => OperationSummary::Generation {
            sample_count,
            source_asset_id: asset_id,
        },
        StoredOperationSummary::Director { asset_id, command } => OperationSummary::Director {
            asset_id,
            tool: crate::session::DirectorToolKind::from_command(&command),
        },
        StoredOperationSummary::EncodeVibe { input } => OperationSummary::EncodeVibe { input },
        StoredOperationSummary::Upscale { asset_id } => OperationSummary::Upscale { asset_id },
    })
}

fn read_summaries(
    connection: &Connection,
    filter: &str,
    parameters: &[&dyn rusqlite::ToSql],
) -> Result<Vec<JobSummary>, PersistenceError> {
    let sql = format!(
        "SELECT j.id, j.status, j.submitted_at, j.finished_at, j.error, j.execution, j.observation, {OPERATION_SUMMARY_SQL}, (SELECT json_group_array(id) FROM (SELECT id FROM generation_results WHERE job_id = j.id ORDER BY sample_index)), j.batch_id, j.request_index, j.request_count, j.retry_of_job_id, j.credential_id FROM jobs j {filter}"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| PersistenceError::failure("prepare task summaries", error))?;
    let rows = statement
        .query_map(parameters, |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, u32>(10)?,
                row.get::<_, u32>(11)?,
                row.get::<_, Option<String>>(12)?,
                row.get::<_, String>(13)?,
            ))
        })
        .map_err(|error| PersistenceError::failure("query task summaries", error))?;
    rows.map(|row| {
        let (
            id,
            status,
            submitted_at,
            finished_at,
            error,
            execution,
            observation,
            operation,
            result_ids,
            batch_id,
            request_index,
            request_count,
            retry_of_job_id,
            credential_id,
        ) = row.map_err(|error| PersistenceError::failure("read a task summary", error))?;
        Ok(JobSummary {
            id: id.to_string(),
            batch_id,
            request_index,
            request_count,
            retry_of_job_id,
            credential_id,
            status: decode(&encode(&status)?)?,
            submitted_at,
            finished_at,
            error,
            execution: decode(&execution)?,
            observation: observation.as_deref().map(decode).transpose()?,
            operation: decode_operation_summary(&operation)?,
            result_ids: decode(&result_ids)?,
        })
    })
    .collect()
}

pub(super) fn list_jobs(
    connection: &Connection,
    query: &JobQuery,
) -> Result<JobPage, PersistenceError> {
    if !(1..=100).contains(&query.limit) {
        return Err(PersistenceError::InvalidData {
            message: "任务分页数量必须在 1 到 100 之间。".to_owned(),
        });
    }
    let bound = query
        .before
        .as_deref()
        .map(parse_id)
        .transpose()?
        .map_or(i64::MAX, |id| id - 1);
    let active = read_summaries(
        connection,
        "WHERE j.status IN ('queued', 'running') ORDER BY j.id DESC",
        &[],
    )?;
    let mut items = read_summaries(
        connection,
        "WHERE j.status NOT IN ('queued', 'running') AND j.id <= ?1 ORDER BY j.id DESC LIMIT ?2",
        &[&bound, &(query.limit + 1)],
    )?;
    let next_cursor = if items.len() > query.limit as usize {
        items.pop();
        items.last().map(|item| item.id.clone())
    } else {
        None
    };
    Ok(JobPage {
        items,
        active,
        next_cursor,
    })
}

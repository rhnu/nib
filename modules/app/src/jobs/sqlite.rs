use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};

use super::{FrozenSubmission, JobRecord, JobStore, SubmissionResolver};
use crate::persistence::{PersistenceError, SqliteDatabase, decode, encode};

/// Only one effective SDK input is retained; the IPC read model is derived from it.
#[derive(serde::Serialize, serde::Deserialize)]
struct StoredSubmission {
    request: novelai_bridge::GenerateImageRequest,
    fragments: Vec<crate::prompt::ResolvedFragment>,
    provenance: crate::prompt::SettingsProvenance,
}

pub(crate) fn encode_submission(submission: &FrozenSubmission) -> Result<String, PersistenceError> {
    encode(&StoredSubmission {
        request: submission.request.clone(),
        fragments: submission.resolved.fragments.clone(),
        provenance: submission.resolved.provenance.clone(),
    })
}

pub(crate) fn decode_submission(content: &str) -> Result<FrozenSubmission, PersistenceError> {
    let stored: StoredSubmission = decode(content)?;
    let normalized = stored.request.clone().normalize().map_err(|error| {
        PersistenceError::failure("validate retained generation settings", error)
    })?;
    let prompts = normalized.resolved_prompts();
    let request = normalized.request();
    let resolved = crate::prompt::ResolvedDraft {
        positive: prompts.prompt.clone(),
        negative: prompts.negative_prompt.clone(),
        fragments: stored.fragments,
        provenance: stored.provenance,
        issues: Vec::new(),
        settings: crate::prompt::ResolvedSettings {
            model: request.core.model,
            size: request.core.size,
            steps: request.sampling.steps,
            scale: request.sampling.scale,
            sampler: request.sampling.sampler,
        },
    };
    Ok(FrozenSubmission {
        resolved,
        seed: request.core.seed,
        request: stored.request,
    })
}

pub(crate) fn timestamp() -> Result<i64, PersistenceError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| PersistenceError::failure("read the current time", error))?;
    i64::try_from(duration.as_millis())
        .map_err(|error| PersistenceError::failure("represent the current time", error))
}

fn read_job(connection: &Connection, id: i64) -> Result<JobRecord, PersistenceError> {
    let (status, submitted_at, finished_at, error, submission): (
        String,
        i64,
        Option<i64>,
        Option<String>,
        String,
    ) = connection
        .query_row(
            "SELECT status, submitted_at, finished_at, error, submission FROM jobs WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .optional()
        .map_err(|error| PersistenceError::failure("read a retained generation job", error))?
        .ok_or_else(|| PersistenceError::NotFound {
            kind: "job",
            id: id.to_string(),
        })?;
    let status = decode(&encode(&status)?)?;
    let mut statement = connection
        .prepare("SELECT id FROM generation_results WHERE job_id = ?1 ORDER BY sample_index")
        .map_err(|error| {
            PersistenceError::failure("prepare generation result identities", error)
        })?;
    let result_ids = statement
        .query_map([id], |row| row.get(0))
        .map_err(|error| PersistenceError::failure("read generation result identities", error))?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|error| PersistenceError::failure("decode generation result identities", error))?;
    Ok(JobRecord {
        id: id.to_string(),
        status,
        submitted_at,
        finished_at,
        error,
        result_ids,
        submission: decode_submission(&submission)?,
    })
}

fn parse_id(id: &str) -> Result<i64, PersistenceError> {
    id.parse::<i64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| PersistenceError::NotFound {
            kind: "job",
            id: id.to_owned(),
        })
}

impl SubmissionResolver for SqliteDatabase {
    fn resolve(
        &self,
        draft: &crate::session::Draft,
    ) -> Result<crate::prompt::ResolvedDraft, PersistenceError> {
        self.read_resources(|reader| crate::prompt::resolve_draft(draft, reader))
    }
}

impl JobStore for SqliteDatabase {
    fn insert_job(&self, submission: &FrozenSubmission) -> Result<JobRecord, PersistenceError> {
        let content = encode_submission(submission)?;
        let now = timestamp()?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction().map_err(|error| {
            PersistenceError::failure("begin retaining a submitted generation job", error)
        })?;
        transaction
            .execute(
                "INSERT INTO jobs (status, submitted_at, submission) VALUES ('queued', ?1, ?2)",
                params![now, content],
            )
            .map_err(|error| {
                PersistenceError::failure("retain a submitted generation job", error)
            })?;
        let record = read_job(&transaction, transaction.last_insert_rowid())?;
        transaction.commit().map_err(|error| {
            PersistenceError::failure("commit a submitted generation job", error)
        })?;
        Ok(record)
    }

    fn get_job(&self, id: &str) -> Result<JobRecord, PersistenceError> {
        let connection = self.connection()?;
        read_job(&connection, parse_id(id)?)
    }

    fn list_jobs(&self) -> Result<Vec<JobRecord>, PersistenceError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT id FROM jobs ORDER BY id DESC")
            .map_err(|error| PersistenceError::failure("prepare generation jobs", error))?;
        let ids = statement
            .query_map([], |row| row.get(0))
            .map_err(|error| PersistenceError::failure("read generation job identities", error))?
            .collect::<Result<Vec<i64>, _>>()
            .map_err(|error| {
                PersistenceError::failure("decode generation job identities", error)
            })?;
        ids.into_iter()
            .map(|id| read_job(&connection, id))
            .collect()
    }

    fn interrupt_jobs(&self) -> Result<(), PersistenceError> {
        self.connection()?.execute(
            "UPDATE jobs SET status = 'interrupted', finished_at = ?1, error = '应用在任务完成前已停止。请明确重试；该请求可能已被扣费。' WHERE status IN ('queued', 'running')", [timestamp()?],
        ).map_err(|error| PersistenceError::failure("interrupt unfinished generation jobs", error))?;
        Ok(())
    }

    fn claim_job(&self) -> Result<Option<JobRecord>, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin claiming a generation job", error))?;
        let id: Option<i64> = transaction
            .query_row(
                "SELECT id FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| PersistenceError::failure("select the next generation job", error))?;
        let Some(id) = id else {
            return Ok(None);
        };
        transaction
            .execute(
                "UPDATE jobs SET status = 'running' WHERE id = ?1 AND status = 'queued'",
                [id],
            )
            .map_err(|error| PersistenceError::failure("start the next generation job", error))?;
        let record = read_job(&transaction, id)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("retain generation start", error))?;
        Ok(Some(record))
    }

    fn cancel_job(&self, id: &str) -> Result<JobRecord, PersistenceError> {
        let connection = self.connection()?;
        connection.execute("UPDATE jobs SET status = 'cancelled', finished_at = ?2, error = NULL WHERE id = ?1 AND status IN ('queued', 'running')", params![parse_id(id)?, timestamp()?])
            .map_err(|error| PersistenceError::failure("cancel a generation job", error))?;
        read_job(&connection, parse_id(id)?)
    }

    fn fail_job(&self, id: &str, message: &str) -> Result<(), PersistenceError> {
        self.connection()?.execute("UPDATE jobs SET status = 'failed', finished_at = ?2, error = ?3 WHERE id = ?1 AND status = 'running'", params![parse_id(id)?, timestamp()?, message])
            .map_err(|error| PersistenceError::failure("retain generation failure", error))?;
        Ok(())
    }
}

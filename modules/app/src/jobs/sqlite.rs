use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OptionalExtension, params};

use super::{FrozenSubmission, JobRecord, JobStore, ParameterDiagnostic, SubmissionResolver};
use crate::persistence::{PersistenceError, SqliteDatabase, decode, encode};

/// Only one SDK parameter set is retained, with immutable media identities and source metadata.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum StoredSubmission {
    Generation {
        request: Box<novelai_bridge::GenerateImageRequest>,
        diagnostics: Vec<ParameterDiagnostic>,
        fragments: Vec<crate::prompt::ResolvedFragment>,
        provenance: Box<crate::prompt::SettingsProvenance>,
        characters: Vec<StoredCharacterSource>,
        inputs: Box<crate::session::CreationInputs>,
        input_sources: Vec<crate::prompt::InputProvenance>,
    },
    Director {
        asset_id: String,
        command: novelai_bridge::DirectorCommand,
        diagnostics: Vec<ParameterDiagnostic>,
    },
    EncodeVibe {
        asset_id: String,
        model: novelai_bridge::Model,
        information_extracted: f32,
        mask_asset_id: Option<String>,
        crop_to_mask: Option<bool>,
        focus_seed: Option<i64>,
        info_extract_seed: Option<i64>,
        diagnostics: Vec<ParameterDiagnostic>,
    },
    Upscale {
        asset_id: String,
        model: novelai_bridge::Model,
        declared_blur_sigma: novelai_bridge::UpscaleBlurSigma,
        diagnostics: Vec<ParameterDiagnostic>,
    },
}

/// Character values belong only to the SDK request; retained application data
/// connects each original SDK index to its composition identity and sources.
#[derive(serde::Serialize, serde::Deserialize)]
struct StoredCharacterSource {
    index: usize,
    id: String,
    fragments: Vec<crate::prompt::ResolvedFragment>,
    preset_instance_id: Option<String>,
    resource_id: Option<String>,
    expanded: bool,
    overridden: bool,
}

pub(crate) fn encode_submission(submission: &FrozenSubmission) -> Result<String, PersistenceError> {
    encode(&match submission {
        FrozenSubmission::Generation {
            request,
            resolved,
            diagnostics,
            ..
        } => StoredSubmission::Generation {
            request: request.clone(),
            diagnostics: diagnostics.clone(),
            fragments: resolved.fragments.clone(),
            provenance: Box::new(resolved.provenance.clone()),
            characters: resolved
                .characters
                .iter()
                .enumerate()
                .map(|(index, character)| StoredCharacterSource {
                    index,
                    id: character.id.clone(),
                    fragments: character.fragments.clone(),
                    preset_instance_id: character.preset_instance_id.clone(),
                    resource_id: character.resource_id.clone(),
                    expanded: character.expanded,
                    overridden: character.overridden,
                })
                .collect(),
            inputs: Box::new(resolved.inputs.clone()),
            input_sources: resolved.input_sources.clone(),
        },
        FrozenSubmission::Director {
            asset_id,
            command,
            diagnostics,
        } => StoredSubmission::Director {
            asset_id: asset_id.clone(),
            command: command.clone(),
            diagnostics: diagnostics.clone(),
        },
        FrozenSubmission::EncodeVibe {
            asset_id,
            model,
            information_extracted,
            mask_asset_id,
            crop_to_mask,
            focus_seed,
            info_extract_seed,
            diagnostics,
        } => StoredSubmission::EncodeVibe {
            asset_id: asset_id.clone(),
            model: *model,
            information_extracted: *information_extracted,
            mask_asset_id: mask_asset_id.clone(),
            crop_to_mask: *crop_to_mask,
            focus_seed: *focus_seed,
            info_extract_seed: *info_extract_seed,
            diagnostics: diagnostics.clone(),
        },
        FrozenSubmission::Upscale {
            asset_id,
            model,
            declared_blur_sigma,
            diagnostics,
        } => StoredSubmission::Upscale {
            asset_id: asset_id.clone(),
            model: *model,
            declared_blur_sigma: *declared_blur_sigma,
            diagnostics: diagnostics.clone(),
        },
    })
}

pub(crate) fn decode_submission(content: &str) -> Result<FrozenSubmission, PersistenceError> {
    Ok(match decode(content)? {
        StoredSubmission::Generation {
            request,
            fragments,
            provenance,
            characters,
            inputs,
            input_sources,
            diagnostics,
        } => {
            // Media is deliberately absent here. Its immutable IDs are resolved only by
            // local quote/preparation; reopening retained metadata needs no image decoding.
            let prompts = request.resolve_prompts().map_err(|error| {
                PersistenceError::failure("resolve retained generation prompts", error)
            })?;
            let characters = restore_character_sources(&request, &prompts, characters)?;
            let resolved = crate::prompt::ResolvedDraft {
                positive: prompts.prompt,
                negative: prompts.negative_prompt,
                fragments,
                provenance: *provenance,
                issues: Vec::new(),
                settings: crate::prompt::ResolvedSettings::from_request(&request),
                characters,
                inputs: *inputs,
                input_sources,
            };
            FrozenSubmission::Generation {
                seed: request.core.seed,
                resolved: Box::new(resolved),
                request,
                diagnostics,
            }
        },
        StoredSubmission::Director {
            asset_id,
            command,
            diagnostics,
        } => FrozenSubmission::Director {
            asset_id,
            command,
            diagnostics,
        },
        StoredSubmission::EncodeVibe {
            asset_id,
            model,
            information_extracted,
            mask_asset_id,
            crop_to_mask,
            focus_seed,
            info_extract_seed,
            diagnostics,
        } => FrozenSubmission::EncodeVibe {
            asset_id,
            model,
            information_extracted,
            mask_asset_id,
            crop_to_mask,
            focus_seed,
            info_extract_seed,
            diagnostics,
        },
        StoredSubmission::Upscale {
            asset_id,
            model,
            declared_blur_sigma,
            diagnostics,
        } => FrozenSubmission::Upscale {
            asset_id,
            model,
            declared_blur_sigma,
            diagnostics,
        },
    })
}

fn restore_character_sources(
    request: &novelai_bridge::GenerateImageRequest,
    prompts: &novelai_bridge::ResolvedPrompts,
    sources: Vec<StoredCharacterSource>,
) -> Result<Vec<crate::prompt::ResolvedCharacter>, PersistenceError> {
    let characters = request
        .characters
        .as_ref()
        .map_or(&[][..], |set| set.characters.as_slice());
    if sources.len() != characters.len() {
        return Err(PersistenceError::InvalidData {
            message: "保留角色的来源与请求不匹配。".to_owned(),
        });
    }
    sources
        .into_iter()
        .enumerate()
        .map(|(index, source)| {
            if source.index != index {
                return Err(PersistenceError::InvalidData {
                    message: "保留角色的来源索引与请求不匹配。".to_owned(),
                });
            }
            let character = &characters[index];
            // Effective prompts contain enabled entries only and preserve their original indices.
            let effective = prompts.characters.iter().find(|entry| entry.index == index);
            Ok(crate::prompt::ResolvedCharacter {
                id: source.id,
                enabled: character.enabled,
                positive: effective
                    .map_or_else(|| character.prompt.clone(), |entry| entry.prompt.clone()),
                negative: effective.map_or_else(
                    || character.negative_prompt.clone().unwrap_or_default(),
                    |entry| entry.negative_prompt.clone(),
                ),
                position: character.position,
                fragments: source.fragments,
                preset_instance_id: source.preset_instance_id,
                resource_id: source.resource_id,
                expanded: source.expanded,
                overridden: source.overridden,
            })
        })
        .collect()
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

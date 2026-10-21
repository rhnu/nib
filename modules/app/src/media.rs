//! Durable final output files and their shared generation records.

mod sqlite;

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
    sync::Arc,
};

use novelai_bridge::{GenerateImageResult, ImageMediaFormat};
use serde::Serialize;

use crate::{
    jobs::{FrozenSubmission, JobRecord},
    persistence::{PersistenceError, SqliteDatabase},
    prompt::{Composition, GenerationSettings, PromptNode},
    session::Draft,
};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct GenerationResult {
    pub id: String,
    pub job_id: String,
    pub sample_index: u32,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub seed: i64,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub created_at: i64,
    pub mime_type: String,
    pub available: bool,
    pub submission: FrozenSubmission,
}

/// Binary delivery stays separate from serializable result metadata.
pub struct MediaContent {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

/// Commits final SDK output only after its bytes are durable. Implementations must
/// atomically retain records and complete the still-running task, preserving cancellation.
pub trait FinalOutputStore: Send + Sync {
    /// # Errors
    /// Returns output validation, file write or record transaction failures.
    fn retain(&self, job: &JobRecord, output: GenerateImageResult) -> Result<(), PersistenceError>;
}

struct RetainedImage {
    result: GenerationResult,
    format: ImageMediaFormat,
    byte_length: i64,
}

/// A file directory and SQLite records form one application media backend.
pub struct MediaLibrary {
    database: Arc<SqliteDatabase>,
    directory: PathBuf,
}

impl MediaLibrary {
    /// Creates the durable output directory.
    ///
    /// # Errors
    /// Returns an underlying directory creation failure.
    pub fn new(
        database: Arc<SqliteDatabase>,
        directory: PathBuf,
    ) -> Result<Self, PersistenceError> {
        fs::create_dir_all(&directory)
            .map_err(|error| PersistenceError::failure("create the media directory", error))?;
        Ok(Self {
            database,
            directory,
        })
    }

    /// Reads shared result records and checks their files before reporting availability.
    ///
    /// # Errors
    /// Returns record decoding or file inspection failures.
    pub fn list(&self) -> Result<Vec<GenerationResult>, PersistenceError> {
        self.database
            .read_results(None)?
            .into_iter()
            .map(|mut image| {
                image.result.available = self.file_available(&image)?;
                Ok(image.result)
            })
            .collect()
    }

    /// Reads a retained final image; missing or truncated files are errors.
    ///
    /// # Errors
    /// Returns missing records, unavailable files or backend failures.
    pub fn read(&self, id: &str) -> Result<MediaContent, PersistenceError> {
        let image = self.get(id)?;
        let mut file = fs::File::open(self.path(&image))
            .map_err(|error| PersistenceError::failure("open the final image file", error))?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|error| PersistenceError::failure("read the final image file", error))?;
        if i64::try_from(bytes.len()).ok() != Some(image.byte_length) {
            return Err(PersistenceError::InvalidData {
                message: "最终图像文件不完整。".to_owned(),
            });
        }
        Ok(MediaContent {
            mime_type: image.result.mime_type,
            bytes,
        })
    }

    /// Restores independent prompt text and effective settings without resource lookups.
    ///
    /// # Errors
    /// Returns missing records, unavailable files or backend failures.
    pub fn restore(&self, id: &str) -> Result<Draft, PersistenceError> {
        let image = self.get(id)?;
        if !self.file_available(&image)? {
            return Err(PersistenceError::NotFound {
                kind: "final image",
                id: id.to_owned(),
            });
        }
        Ok(restore_submission(&image.result.submission))
    }

    fn get(&self, id: &str) -> Result<RetainedImage, PersistenceError> {
        self.database
            .read_results(Some(id))?
            .into_iter()
            .next()
            .ok_or_else(|| PersistenceError::NotFound {
                kind: "result",
                id: id.to_owned(),
            })
    }

    fn path(&self, image: &RetainedImage) -> PathBuf {
        // Numeric database identities and the SDK format are the only path components.
        self.directory.join(format!(
            "{}-{}.{}",
            image.result.job_id,
            image.result.sample_index,
            image.format.extension()
        ))
    }

    fn file_available(&self, image: &RetainedImage) -> Result<bool, PersistenceError> {
        match fs::metadata(self.path(image)) {
            Ok(metadata) => {
                Ok(metadata.is_file()
                    && i64::try_from(metadata.len()).ok() == Some(image.byte_length))
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(PersistenceError::failure(
                "inspect the final image file",
                error,
            )),
        }
    }
}

impl FinalOutputStore for MediaLibrary {
    fn retain(&self, job: &JobRecord, output: GenerateImageResult) -> Result<(), PersistenceError> {
        if output.images.is_empty() {
            return Err(PersistenceError::InvalidData {
                message: "NovelAI 未返回最终图像。".to_owned(),
            });
        }
        let now = crate::jobs::timestamp()?;
        let mut images = Vec::new();
        for (index, generated) in output.images.into_iter().enumerate() {
            let sample_index = u32::try_from(index).map_err(|error| {
                PersistenceError::failure("represent a result sample index", error)
            })?;
            let image = RetainedImage {
                result: GenerationResult {
                    id: format!("{}-{sample_index}", job.id),
                    job_id: job.id.clone(),
                    sample_index,
                    seed: generated.seed().unwrap_or(output.resolved_seed),
                    created_at: now,
                    mime_type: generated.mime_type().to_owned(),
                    available: true,
                    submission: job.submission.clone(),
                },
                format: generated.format(),
                byte_length: i64::try_from(generated.bytes().len()).map_err(|error| {
                    PersistenceError::failure("represent the final image size", error)
                })?,
            };
            // Uncommitted files are never visible through result queries. A failed write
            // may leave an orphan, but can never make a partial image a usable result.
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(self.path(&image))
                .map_err(|error| PersistenceError::failure("create the final image file", error))?;
            file.write_all(generated.bytes())
                .map_err(|error| PersistenceError::failure("write the final image file", error))?;
            file.sync_all()
                .map_err(|error| PersistenceError::failure("flush the final image file", error))?;
            images.push(image);
        }
        self.database.commit_results(&job.id, &images)
    }
}

fn restore_submission(submission: &FrozenSubmission) -> Draft {
    let request = &submission.request;
    Draft {
        revision: 0,
        composition: Composition {
            positive: vec![PromptNode::Text {
                id: "restored-positive".to_owned(),
                enabled: true,
                text: request.core.prompt.clone(),
            }],
            negative: vec![PromptNode::Text {
                id: "restored-negative".to_owned(),
                enabled: true,
                text: request.core.negative_prompt.clone().unwrap_or_default(),
            }],
        },
        presets: Vec::new(),
        settings: GenerationSettings {
            model: Some(request.core.model),
            size: Some(request.core.size),
            steps: Some(request.sampling.steps),
            scale: Some(request.sampling.scale),
            sampler: Some(request.sampling.sampler),
        },
    }
}

#[cfg(test)]
mod tests;

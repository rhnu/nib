//! Durable immutable media assets, operation outputs and independent result reuse.

mod assets;
mod metadata;
mod sqlite;
mod vibe;
use std::{fs, path::PathBuf, sync::Arc};

pub use assets::{AssetKind, AssetReader, AssetSource, MediaAsset};
pub use metadata::{
    ImageMetadataReport, ImageMetadataStatus, KnownCharacterMetadata, KnownImageMetadata,
};
use novelai_bridge::{
    GenerateImageResult, GeneratedImage, GeneratedImageSource, RunDirectorToolResult,
    UpscaleImageResult, VibeEncoding,
};
use serde::{Deserialize, Serialize};
pub use vibe::{
    VibeAssetInspection, VibeCacheSummary, VibeDocumentEntry, VibeDocumentInspection,
    VibeSourceDocument,
};

use crate::{
    jobs::{FrozenSubmission, JobRecord},
    persistence::{PersistenceError, SqliteDatabase},
    session::{CreationInputs, CreationOperation, Draft, DraftStore, MaskEditorState},
};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct GenerationResult {
    pub id: String,
    pub job_id: String,
    pub sample_index: u32,
    pub asset_id: String,
    pub kind: AssetKind,
    pub image_source: Option<ResultImageSource>,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub seed: Option<i64>,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub created_at: i64,
    pub mime_type: String,
    pub available: bool,
    pub submission: FrozenSubmission,
}

/// Durable response identity; the SDK's source type is intentionally serialize-only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ResultImageSource {
    Raw,
    Archive {
        name: String,
        index: usize,
    },
    Json {
        position: usize,
        #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
        index: Option<i64>,
        #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
        seed: Option<i64>,
    },
}

impl TryFrom<&GeneratedImageSource> for ResultImageSource {
    type Error = PersistenceError;

    fn try_from(source: &GeneratedImageSource) -> Result<Self, Self::Error> {
        match source {
            GeneratedImageSource::Raw => Ok(Self::Raw),
            GeneratedImageSource::Archive { name, index } => Ok(Self::Archive {
                name: name.clone(),
                index: *index,
            }),
            GeneratedImageSource::Json {
                position,
                index,
                seed,
            } => Ok(Self::Json {
                position: *position,
                index: *index,
                seed: *seed,
            }),
            _ => Err(PersistenceError::InvalidData {
                message: "SDK 返回了尚不支持保存的图片来源类型。".to_owned(),
            }),
        }
    }
}

/// Binary delivery stays separate from serializable asset and result metadata.
pub struct MediaContent {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

/// SDK outputs preserve the distinction between images and opaque Vibe material.
pub enum JobOutput {
    Generation(GenerateImageResult),
    Director(RunDirectorToolResult),
    Upscale(UpscaleImageResult),
    Vibe(VibeEncoding),
}

/// Commits outputs only after their bytes are durable, while preserving cancellation.
pub trait FinalOutputStore: Send + Sync {
    /// # Errors
    /// Returns output validation, file write or record transaction failures.
    fn retain(&self, job: &JobRecord, output: JobOutput) -> Result<(), PersistenceError>;
}

struct RetainedOutput {
    result: GenerationResult,
    asset: MediaAsset,
}

struct GenerationSample {
    index: u32,
    image: GeneratedImage,
    seed: Option<i64>,
}

fn generation_samples(
    output: GenerateImageResult,
) -> Result<Vec<GenerationSample>, PersistenceError> {
    image_samples(output.images)
}

fn image_samples(images: Vec<GeneratedImage>) -> Result<Vec<GenerationSample>, PersistenceError> {
    if images.is_empty() {
        return Err(PersistenceError::InvalidData {
            message: "NovelAI 未返回最终图像。".to_owned(),
        });
    }
    images
        .into_iter()
        .enumerate()
        .map(|(index, image)| {
            let index = u32::try_from(index)
                .map_err(|error| PersistenceError::failure("represent a sample index", error))?;
            // A request seed does not establish an individual sample's actual seed.
            let seed = image.seed().or(match image.source() {
                GeneratedImageSource::Json { seed, .. } => *seed,
                _ => None,
            });
            Ok(GenerationSample { index, image, seed })
        })
        .collect()
}

/// A file directory and SQLite records form one application media backend.
pub struct MediaLibrary {
    database: Arc<SqliteDatabase>,
    directory: PathBuf,
}

/// Metadata import reports its partial nature alongside the usable editing fields.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct MetadataRestore {
    pub draft: Draft,
    pub notices: Vec<String>,
}

impl MediaLibrary {
    /// Creates the immutable content directory.
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

    /// Lists final operation outputs and checks their immutable content availability.
    ///
    /// # Errors
    /// Returns record decoding or file inspection failures.
    pub fn list(&self) -> Result<Vec<GenerationResult>, PersistenceError> {
        self.database
            .read_results(None)?
            .into_iter()
            .map(|mut output| {
                output.result.available = self.asset_available(&output.asset)?;
                Ok(output.result)
            })
            .collect()
    }

    /// Reads a final image or Vibe result by identity.
    ///
    /// # Errors
    /// Returns unknown records, missing/truncated files or backend failures.
    pub fn read(&self, id: &str) -> Result<MediaContent, PersistenceError> {
        self.content(&self.get(id)?.asset)
    }

    /// Restores effective editing content without consulting old resource definitions.
    ///
    /// # Errors
    /// Returns unavailable output or required input material, or backend failures.
    pub fn restore(&self, id: &str) -> Result<Draft, PersistenceError> {
        let output = self.get(id)?;
        if !self.asset_available(&output.asset)? {
            return Err(PersistenceError::NotFound {
                kind: "output media",
                id: id.to_owned(),
            });
        }
        let current = self.database.get_draft()?;
        let mut draft = restore_submission(
            &output.result.submission,
            output.result.seed,
            current.mask_editor,
        );
        draft.vibe_encoder = current.vibe_encoder;
        self.validate_inputs(&draft.inputs)?;
        Ok(draft)
    }

    /// Restores fields recognized by the SDK, with explicit notes about missing inputs.
    ///
    /// # Errors
    /// Returns an unavailable/non-image asset or absent generation metadata.
    pub fn restore_metadata(&self, id: &str) -> Result<MetadataRestore, PersistenceError> {
        let asset = self.asset(id)?;
        if asset.kind != AssetKind::Image {
            return Err(PersistenceError::InvalidData {
                message: "Vibe 编码不是可读取生成信息的图片。".to_owned(),
            });
        }
        let inspection = self.inspect_sdk_metadata(id)?;
        let metadata = inspection
            .parsed()
            .filter(|metadata| metadata.has_generation_data())
            .ok_or_else(|| PersistenceError::InvalidData {
                message: "图片没有可恢复的生成信息。".to_owned(),
            })?;
        let mut notices =
            vec!["仅恢复图片中已知的字段；未包含的设置、参考材料和遮罩无法还原。".to_owned()];
        if !metadata.characters.is_empty() {
            notices
                .push("角色文字可在元信息详情查看；缺少完整位置，角色与位置均未恢复。".to_owned());
        }
        if !metadata.vibe_entries.is_empty() {
            notices.push("嵌入 Vibe 材料可单独导入；生成信息不代表完整参考配置。".to_owned());
        }
        if !metadata.warnings.is_empty() {
            notices.push("SDK 在元信息中发现无法解释的字段，请检查导入内容。".to_owned());
        }
        let mut draft = crate::session::draft_from_metadata(metadata);
        let current = self.database.get_draft()?;
        draft.mask_editor = current.mask_editor;
        draft.vibe_encoder = current.vibe_encoder;
        if metadata.uc_preset.is_some() && metadata.negative_prompt.is_none() {
            notices.push("图片仅记录了旧版负面预设索引，无法确定当前预设，请重新选择。".to_owned());
        }
        if metadata.model.is_some() && draft.settings.model.is_none() {
            notices.push("图片中的模型标识不受当前 SDK 识别，未据此选择模型。".to_owned());
        }
        if metadata.sampler.is_some() && draft.settings.sampler.is_none() {
            notices.push("图片中的采样器标识不受当前 SDK 识别，未据此选择采样器。".to_owned());
        }
        if metadata.noise_schedule.is_some() && draft.settings.noise_schedule.is_none() {
            notices.push("图片中的噪声调度标识不受当前 SDK 识别，未据此选择噪声调度。".to_owned());
        }
        if metadata.prompt.is_some() || metadata.negative_prompt.is_some() {
            notices.push(
                "提示词按图片记录的实际文字恢复，自动质量与负面预设不会重复追加。".to_owned(),
            );
        }
        Ok(MetadataRestore { draft, notices })
    }

    fn validate_inputs(&self, inputs: &CreationInputs) -> Result<(), PersistenceError> {
        // Hydration uses the same immutable identity validation as submission; it does not
        // validate NAI parameter semantics or create a second request representation.
        let image_ids: Vec<&str> = match &inputs.operation {
            CreationOperation::TextToImage => Vec::new(),
            CreationOperation::ImageToImage { asset_id, .. }
            | CreationOperation::Director { asset_id, .. }
            | CreationOperation::Upscale { asset_id, .. } => vec![asset_id],
            CreationOperation::EncodeVibe(crate::session::VibeEncodingInput {
                asset_id,
                mask_asset_id,
                ..
            }) => std::iter::once(asset_id.as_str())
                .chain(mask_asset_id.as_deref())
                .collect(),
            CreationOperation::Inpainting {
                asset_id,
                mask_asset_id,
                ..
            } => vec![asset_id, mask_asset_id],
        };
        for id in image_ids.into_iter().chain(
            inputs
                .references
                .precise
                .iter()
                .map(|reference| reference.asset_id.as_str()),
        ) {
            self.require_asset(id, AssetKind::Image)?;
        }
        for reference in &inputs.references.vibes {
            let (id, kind) = match &reference.input {
                crate::session::VibeInput::Encoded { asset_id } => (asset_id, AssetKind::Vibe),
                crate::session::VibeInput::Image { asset_id, .. } => (asset_id, AssetKind::Image),
            };
            self.require_asset(id, kind)?;
        }
        Ok(())
    }

    fn require_asset(&self, id: &str, kind: AssetKind) -> Result<(), PersistenceError> {
        let asset = self.asset(id)?;
        if asset.kind != kind || !asset.available {
            return Err(PersistenceError::InvalidData {
                message: format!("所需媒体 {id} 不可用或类型不匹配。"),
            });
        }
        Ok(())
    }

    fn get(&self, id: &str) -> Result<RetainedOutput, PersistenceError> {
        self.database
            .read_results(Some(id))?
            .into_iter()
            .next()
            .ok_or_else(|| PersistenceError::NotFound {
                kind: "result",
                id: id.to_owned(),
            })
    }

    fn stage_image(
        &self,
        job: &JobRecord,
        sample_index: u32,
        image: GeneratedImage,
        seed: Option<i64>,
    ) -> Result<RetainedOutput, PersistenceError> {
        let format = image.format();
        let source = ResultImageSource::try_from(image.source())?;
        // GeneratedImage has no decoded-size accessor. Move its payload into the SDK
        // image boundary to obtain actual dimensions without trusting embedded metadata.
        let image = novelai_bridge::EncodedImage::from_bytes(image.into_bytes())
            .map_err(|error| PersistenceError::failure("inspect final image dimensions", error))?;
        let size = image.size();
        let asset = self.stage_asset(
            AssetKind::Image,
            format.mime_type(),
            image.as_bytes(),
            Some((size.width, size.height)),
            AssetSource::Job {
                job_id: job.id.clone(),
            },
        )?;
        Ok(retained(job, sample_index, seed, Some(source), asset))
    }
}

impl FinalOutputStore for MediaLibrary {
    fn retain(&self, job: &JobRecord, output: JobOutput) -> Result<(), PersistenceError> {
        let retained = match output {
            JobOutput::Generation(output) => generation_samples(output)?
                .into_iter()
                .map(|sample| self.stage_image(job, sample.index, sample.image, sample.seed))
                .collect::<Result<Vec<_>, _>>()?,
            JobOutput::Director(output) => image_samples(output.images)?
                .into_iter()
                .map(|sample| self.stage_image(job, sample.index, sample.image, sample.seed))
                .collect::<Result<Vec<_>, _>>()?,
            JobOutput::Upscale(output) => image_samples(output.images)?
                .into_iter()
                .map(|sample| self.stage_image(job, sample.index, sample.image, sample.seed))
                .collect::<Result<Vec<_>, _>>()?,
            JobOutput::Vibe(encoding) => {
                let asset = self.stage_asset(
                    AssetKind::Vibe,
                    "application/octet-stream",
                    encoding.as_bytes(),
                    None,
                    AssetSource::Job {
                        job_id: job.id.clone(),
                    },
                )?;
                vec![retained(job, 0, None, None, asset)]
            },
        };
        // Every staged file has been completely written and synchronized. The single
        // transaction keeps both assets and outputs invisible if cancellation won.
        self.database.commit_results(&job.id, &retained)
    }
}

fn retained(
    job: &JobRecord,
    sample_index: u32,
    seed: Option<i64>,
    image_source: Option<ResultImageSource>,
    asset: MediaAsset,
) -> RetainedOutput {
    RetainedOutput {
        result: GenerationResult {
            id: format!("{}-{sample_index}", job.id),
            job_id: job.id.clone(),
            sample_index,
            asset_id: asset.id.clone(),
            kind: asset.kind,
            image_source,
            seed,
            created_at: asset.created_at,
            mime_type: asset.mime_type.clone(),
            available: true,
            submission: job.submission.clone(),
        },
        asset,
    }
}

fn restore_submission(
    submission: &FrozenSubmission,
    seed: Option<i64>,
    mask_editor: MaskEditorState,
) -> Draft {
    let mut draft = match submission {
        FrozenSubmission::Generation {
            request, resolved, ..
        } => {
            let mut draft = crate::session::restore_generation(request, resolved.inputs.clone());
            // Without a known sample seed this restores the original submission's seed;
            // it does not claim to reproduce the selected sample.
            draft.settings.seed = seed.or(Some(request.core.seed));
            draft
        },
        FrozenSubmission::Director {
            asset_id,
            command,
            policy,
            ..
        } => Draft {
            inputs: CreationInputs {
                policy: *policy,
                operation: CreationOperation::Director {
                    asset_id: asset_id.clone(),
                    command: command.clone(),
                },
                ..CreationInputs::default()
            },
            ..Draft::default()
        },
        FrozenSubmission::EncodeVibe {
            asset_id,
            model,
            information_extracted,
            mask_asset_id,
            crop_to_mask,
            focus_seed,
            info_extract_seed,
            policy,
            ..
        } => Draft {
            inputs: CreationInputs {
                policy: *policy,
                operation: CreationOperation::EncodeVibe(crate::session::VibeEncodingInput {
                    asset_id: asset_id.clone(),
                    model: *model,
                    information_extracted: *information_extracted,
                    mask_asset_id: mask_asset_id.clone(),
                    crop_to_mask: *crop_to_mask,
                    focus_seed: *focus_seed,
                    info_extract_seed: *info_extract_seed,
                }),
                ..CreationInputs::default()
            },
            ..Draft::default()
        },
        FrozenSubmission::Upscale {
            asset_id,
            model,
            declared_blur_sigma,
            ..
        } => Draft {
            inputs: CreationInputs {
                operation: CreationOperation::Upscale {
                    asset_id: asset_id.clone(),
                    model: *model,
                    declared_blur_sigma: *declared_blur_sigma,
                },
                ..CreationInputs::default()
            },
            ..Draft::default()
        },
    };
    // Canvas work is current application state, never part of a frozen submission.
    draft.mask_editor = mask_editor;
    draft
}

#[cfg(test)]
mod tests;

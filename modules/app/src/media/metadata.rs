use novelai_bridge::{GeneratedImageMetadata, ImageSize, MetadataOrigin};
use serde::Serialize;

use super::{AssetReader as _, MediaLibrary};
use crate::{api::UserMessage, persistence::PersistenceError, session::PngTextValue};

/// Complete SDK text values, including unrecognized keywords and repeated values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PngTextInspection {
    pub entries: Vec<PngTextValue>,
    pub warnings: Vec<UserMessage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ImageMetadataStatus {
    Parsed,
    NotPresent,
    UnsupportedFormat,
    Invalid,
}

/// The known metadata fields useful for editing, without raw chunks or embedded bytes.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct KnownImageMetadata {
    #[cfg_attr(
        feature = "typegen",
        ts(type = "\"png_text\" | \"exif_user_comment\" | \"stealth_png_comp\" | null")
    )]
    pub origin: Option<MetadataOrigin>,
    pub prompt: Option<String>,
    pub negative_prompt: Option<String>,
    pub model: Option<String>,
    #[cfg_attr(feature = "typegen", ts(type = "number | null"))]
    pub seed: Option<i64>,
    #[cfg_attr(
        feature = "typegen",
        ts(type = "{ width: number; height: number } | null")
    )]
    pub size: Option<ImageSize>,
    pub steps: Option<u32>,
    pub sampler: Option<String>,
    pub scale: Option<f32>,
    pub noise_schedule: Option<String>,
    pub cfg_rescale: Option<f32>,
    pub uc_preset: Option<i32>,
    pub quality_toggle: Option<bool>,
    pub source: Option<String>,
    pub software: Option<String>,
    pub characters: Vec<KnownCharacterMetadata>,
    pub embedded_vibe_count: usize,
}

/// Recognized text does not imply that missing character positions can be restored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct KnownCharacterMetadata {
    pub source_index: usize,
    pub prompt: Option<String>,
    pub negative_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ImageMetadataReport {
    pub status: ImageMetadataStatus,
    pub generation: Option<KnownImageMetadata>,
    pub warnings: Vec<UserMessage>,
}

impl MediaLibrary {
    /// Reads PNG text through the SDK without projecting it into known generation fields.
    ///
    /// # Errors
    /// Returns unavailable/non-PNG media or SDK PNG validation failures.
    pub fn inspect_png_text(&self, id: &str) -> Result<PngTextInspection, PersistenceError> {
        let image = self.image(id)?;
        let metadata = novelai_bridge::parse_png_metadata_from_bytes(image.as_bytes())
            .map_err(|error| PersistenceError::failure("inspect retained PNG text", error))?;
        Ok(png_text_inspection(metadata))
    }

    /// Projects SDK metadata into a bounded application view; unknown values stay absent.
    ///
    /// # Errors
    /// Returns an unavailable asset, an incompatible kind or a file read failure.
    pub fn inspect_metadata(&self, id: &str) -> Result<ImageMetadataReport, PersistenceError> {
        Ok(metadata_report(&self.inspect_sdk_metadata(id)?))
    }
}

pub(super) fn png_text_inspection(metadata: novelai_bridge::ImageMetadata) -> PngTextInspection {
    // PNG parsing can fall back to Exif/stealth. Those carriers expose synthetic text
    // keys for generation interpretation, not actual PNG text chunks.
    let chunks = if metadata.origin == Some(MetadataOrigin::PngText) {
        metadata.text_chunks
    } else {
        std::collections::BTreeMap::new()
    };
    PngTextInspection {
        entries: chunks
            .into_iter()
            .flat_map(|(keyword, values)| {
                values.into_iter().map(move |text| PngTextValue {
                    keyword: keyword.clone(),
                    text,
                })
            })
            .collect(),
        warnings: metadata
            .warnings
            .iter()
            .map(|warning| UserMessage::external(format!("{warning:?}")))
            .collect(),
    }
}

pub(super) fn metadata_report(inspection: &GeneratedImageMetadata) -> ImageMetadataReport {
    match inspection {
        GeneratedImageMetadata::Parsed(metadata) => ImageMetadataReport {
            status: ImageMetadataStatus::Parsed,
            generation: Some(KnownImageMetadata {
                origin: metadata.origin,
                prompt: metadata.prompt.clone(),
                negative_prompt: metadata.negative_prompt.clone(),
                model: metadata.model.clone(),
                seed: metadata.seed,
                size: metadata
                    .width
                    .zip(metadata.height)
                    .map(|(width, height)| ImageSize { width, height }),
                steps: metadata.steps,
                sampler: metadata.sampler.clone(),
                scale: metadata.scale,
                noise_schedule: metadata.noise_schedule.clone(),
                cfg_rescale: metadata.cfg_rescale,
                uc_preset: metadata.uc_preset,
                quality_toggle: metadata.quality_toggle,
                source: metadata.source.clone(),
                software: metadata.software.clone(),
                characters: metadata
                    .characters
                    .iter()
                    .map(|character| KnownCharacterMetadata {
                        source_index: character.source_index,
                        prompt: character.prompt.clone(),
                        negative_prompt: character.negative_prompt.clone(),
                    })
                    .collect(),
                embedded_vibe_count: metadata.vibe_entries.len(),
            }),
            warnings: metadata
                .warnings
                .iter()
                .map(|warning| UserMessage::external(format!("{warning:?}")))
                .collect(),
        },
        GeneratedImageMetadata::NotPresent => ImageMetadataReport {
            status: ImageMetadataStatus::NotPresent,
            generation: None,
            warnings: Vec::new(),
        },
        GeneratedImageMetadata::UnsupportedFormat => ImageMetadataReport {
            status: ImageMetadataStatus::UnsupportedFormat,
            generation: None,
            warnings: Vec::new(),
        },
        GeneratedImageMetadata::Invalid { message } => ImageMetadataReport {
            status: ImageMetadataStatus::Invalid,
            generation: None,
            warnings: vec![UserMessage::external(message.clone())],
        },
    }
}

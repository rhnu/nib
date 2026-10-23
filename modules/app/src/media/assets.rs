use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use novelai_bridge::{EncodedImage, GeneratedImageMetadata, ImageMediaFormat, VibeEncoding};
use serde::{Deserialize, Serialize};

use super::{MediaContent, MediaLibrary};
use crate::persistence::PersistenceError;

/// Content type is independent of its use as a source, mask or reference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum AssetKind {
    Image,
    Vibe,
    VibeDocument,
}

/// Describes application provenance without granting access to an external path.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum AssetSource {
    Import {
        name: Option<String>,
    },
    Asset {
        asset_id: String,
    },
    EmbeddedVibe {
        asset_id: String,
        entry_index: usize,
        model: Option<String>,
        parameter_key: Option<String>,
        display_name: Option<String>,
        strength: Option<f32>,
        information_extracted: Option<f32>,
    },
    Job {
        job_id: String,
    },
    VibeDocumentEntry {
        asset_id: String,
        entry_index: usize,
        model: Option<String>,
        parameter_key: Option<String>,
    },
    PngVibeDocument {
        image_asset_id: String,
        document_asset_id: String,
    },
    VibeBundle {
        asset_ids: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct MediaAsset {
    pub id: String,
    pub kind: AssetKind,
    pub mime_type: String,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub byte_length: i64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    #[cfg_attr(feature = "typegen", ts(type = "number"))]
    pub created_at: i64,
    pub source: AssetSource,
    pub available: bool,
}

/// Frozen submissions resolve immutable identities at the media boundary.
pub trait AssetReader: Send + Sync {
    /// # Errors
    /// Returns an unknown identity, an incompatible kind or an unavailable/invalid image.
    fn image(&self, id: &str) -> Result<EncodedImage, PersistenceError>;

    /// # Errors
    /// Returns an unknown identity, an incompatible kind or an unavailable/invalid encoding.
    fn vibe(&self, id: &str) -> Result<VibeEncoding, PersistenceError>;
}

impl MediaLibrary {
    /// Validates and durably imports an image; no external file remains required.
    ///
    /// # Errors
    /// Returns SDK image validation or durable storage failures.
    pub fn import_image(
        &self,
        bytes: Vec<u8>,
        source: AssetSource,
    ) -> Result<MediaAsset, PersistenceError> {
        let image = EncodedImage::from_bytes(bytes)
            .map_err(|error| PersistenceError::failure("validate an imported image", error))?;
        self.retain_image(&image, source)
    }

    pub(super) fn retain_image(
        &self,
        image: &EncodedImage,
        source: AssetSource,
    ) -> Result<MediaAsset, PersistenceError> {
        self.validate_source(&source)?;
        let format = image_format(image.as_bytes());
        let size = image.size();
        let asset = self.stage_asset(
            AssetKind::Image,
            format.mime_type(),
            image.as_bytes(),
            Some((size.width, size.height)),
            source,
        )?;
        self.database.insert_asset(&asset)?;
        Ok(asset)
    }

    /// Imports an opaque Vibe encoding using the SDK's encoding validation.
    ///
    /// # Errors
    /// Returns SDK validation or durable storage failures.
    pub fn import_vibe(
        &self,
        bytes: Vec<u8>,
        source: AssetSource,
    ) -> Result<MediaAsset, PersistenceError> {
        let encoding = VibeEncoding::from_bytes(bytes).map_err(|error| {
            PersistenceError::failure("validate an imported Vibe encoding", error)
        })?;
        self.retain_vibe(&encoding, source)
    }

    pub(super) fn retain_vibe(
        &self,
        encoding: &VibeEncoding,
        source: AssetSource,
    ) -> Result<MediaAsset, PersistenceError> {
        self.validate_source(&source)?;
        let asset = self.stage_asset(
            AssetKind::Vibe,
            "application/octet-stream",
            encoding.as_bytes(),
            None,
            source,
        )?;
        self.database.insert_asset(&asset)?;
        Ok(asset)
    }

    /// Lists immutable content independently of generation history.
    ///
    /// # Errors
    /// Returns database decoding or file inspection failures.
    pub fn list_assets(&self) -> Result<Vec<MediaAsset>, PersistenceError> {
        self.database
            .read_assets(None)?
            .into_iter()
            .map(|mut asset| {
                asset.available = self.asset_available(&asset)?;
                Ok(asset)
            })
            .collect()
    }

    /// Reads a stable asset identity as bytes, with no user-controlled filesystem path.
    ///
    /// # Errors
    /// Returns unknown assets, missing/truncated files or storage failures.
    pub fn read_asset(&self, id: &str) -> Result<MediaContent, PersistenceError> {
        let asset = self.asset(id)?;
        self.content(&asset)
    }

    /// Reads a bounded, rebuildable PNG preview without creating another media asset.
    ///
    /// # Errors
    /// Returns unavailable images, decoding failures or thumbnail cache I/O failures.
    pub fn thumbnail(&self, id: &str) -> Result<MediaContent, PersistenceError> {
        let _guard = self
            .thumbnails
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        let asset = self.asset(id)?;
        if asset.kind != AssetKind::Image || !asset.available {
            return Err(PersistenceError::InvalidData {
                message: "缩略图的源图不可用。".to_owned(),
            });
        }
        let directory = self.directory.join("thumbnails");
        let path = directory.join(format!("{}.png", asset.id));
        match fs::read(&path) {
            Ok(bytes) => {
                if bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                    && let Ok(image) = EncodedImage::from_bytes(bytes)
                    && image.size().width <= 256
                    && image.size().height <= 256
                {
                    return Ok(MediaContent {
                        mime_type: "image/png".to_owned(),
                        bytes: image.as_bytes().to_vec(),
                    });
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(PersistenceError::failure("read a media thumbnail", error)),
        }
        let image = self.image_content(&asset)?;
        let prepared = prepare_thumbnail(&image)?;
        fs::create_dir_all(&directory)
            .map_err(|error| PersistenceError::failure("create the thumbnail directory", error))?;
        let temporary = directory.join(format!("{}.partial", asset.id));
        fs::write(&temporary, prepared.as_bytes())
            .map_err(|error| PersistenceError::failure("write a media thumbnail", error))?;
        fs::rename(&temporary, &path)
            .map_err(|error| PersistenceError::failure("publish a media thumbnail", error))?;
        Ok(MediaContent {
            mime_type: "image/png".to_owned(),
            bytes: prepared.as_bytes().to_vec(),
        })
    }

    /// Retrieves one asset and its current file availability.
    ///
    /// # Errors
    /// Returns an unknown identity or a backend failure.
    pub fn asset(&self, id: &str) -> Result<MediaAsset, PersistenceError> {
        let mut asset = self
            .database
            .read_assets(Some(id))?
            .into_iter()
            .next()
            .ok_or_else(|| PersistenceError::NotFound {
                kind: "media asset",
                id: id.to_owned(),
            })?;
        asset.available = self.asset_available(&asset)?;
        Ok(asset)
    }

    /// Saves supported embedded Vibe encodings as distinct reusable assets.
    ///
    /// # Errors
    /// Returns missing images, malformed encoding payloads or storage failures.
    pub fn import_embedded_vibes(&self, id: &str) -> Result<Vec<MediaAsset>, PersistenceError> {
        let inspection = self.inspect_sdk_metadata(id)?;
        let Some(metadata) = inspection.parsed() else {
            return Ok(Vec::new());
        };
        let encodings = embedded_vibe_encodings(id, metadata)?;
        let imported = encodings
            .into_iter()
            .map(|(encoding, source)| {
                self.stage_asset(
                    AssetKind::Vibe,
                    "application/octet-stream",
                    encoding.as_bytes(),
                    None,
                    source,
                )
            })
            .collect::<Result<Vec<_>, _>>()?;
        self.database.insert_assets(&imported)?;
        Ok(imported)
    }

    /// Reads SDK image metadata on demand; embedded payloads are not copied into SQLite.
    ///
    /// # Errors
    /// Returns an unavailable asset, an incompatible kind or a file read failure.
    pub(super) fn inspect_sdk_metadata(
        &self,
        id: &str,
    ) -> Result<GeneratedImageMetadata, PersistenceError> {
        let asset = self.asset(id)?;
        if asset.kind != AssetKind::Image {
            return Err(wrong_kind(id, AssetKind::Image));
        }
        let content = self.content(&asset)?;
        Ok(novelai_bridge::inspect_generated_image_metadata(
            &content.bytes,
            Some(&content.mime_type),
        ))
    }

    pub(super) fn stage_asset(
        &self,
        kind: AssetKind,
        mime_type: &str,
        bytes: &[u8],
        dimensions: Option<(u32, u32)>,
        source: AssetSource,
    ) -> Result<MediaAsset, PersistenceError> {
        let id = next_asset_id()?;
        let asset = MediaAsset {
            id,
            kind,
            mime_type: mime_type.to_owned(),
            byte_length: i64::try_from(bytes.len()).map_err(|error| {
                PersistenceError::failure("represent media content size", error)
            })?,
            width: dimensions.map(|(width, _)| width),
            height: dimensions.map(|(_, height)| height),
            created_at: crate::jobs::timestamp()?,
            source,
            available: true,
        };
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.asset_path(&asset.id)?)
            .map_err(|error| PersistenceError::failure("create immutable media content", error))?;
        file.write_all(bytes)
            .map_err(|error| PersistenceError::failure("write immutable media content", error))?;
        file.sync_all()
            .map_err(|error| PersistenceError::failure("sync immutable media content", error))?;
        Ok(asset)
    }

    pub(super) fn content(&self, asset: &MediaAsset) -> Result<MediaContent, PersistenceError> {
        let mut file = fs::File::open(self.asset_path(&asset.id)?)
            .map_err(|error| PersistenceError::failure("open immutable media content", error))?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|error| PersistenceError::failure("read immutable media content", error))?;
        if i64::try_from(bytes.len()).ok() != Some(asset.byte_length) {
            return Err(PersistenceError::InvalidData {
                message: "媒体文件不完整。".to_owned(),
            });
        }
        Ok(MediaContent {
            mime_type: asset.mime_type.clone(),
            bytes,
        })
    }

    fn asset_path(&self, id: &str) -> Result<std::path::PathBuf, PersistenceError> {
        if !id.starts_with("asset-")
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_digit() || byte == b'-' || byte.is_ascii_lowercase())
        {
            return Err(PersistenceError::InvalidData {
                message: "媒体身份无效。".to_owned(),
            });
        }
        Ok(self.directory.join(id))
    }

    pub(super) fn asset_available(&self, asset: &MediaAsset) -> Result<bool, PersistenceError> {
        match fs::metadata(self.asset_path(&asset.id)?) {
            Ok(metadata) => {
                Ok(metadata.is_file()
                    && i64::try_from(metadata.len()).ok() == Some(asset.byte_length))
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(PersistenceError::failure(
                "inspect immutable media content",
                error,
            )),
        }
    }

    pub(super) fn validate_source(&self, source: &AssetSource) -> Result<(), PersistenceError> {
        match source {
            AssetSource::Asset { asset_id }
            | AssetSource::EmbeddedVibe { asset_id, .. }
            | AssetSource::VibeDocumentEntry { asset_id, .. } => {
                self.asset(asset_id)?;
            },
            AssetSource::PngVibeDocument {
                image_asset_id,
                document_asset_id,
            } => {
                self.require_asset(image_asset_id, AssetKind::Image)?;
                self.require_asset(document_asset_id, AssetKind::VibeDocument)?;
            },
            AssetSource::Job { job_id } => {
                use crate::jobs::JobStore;
                self.database.get_job(job_id)?;
            },
            AssetSource::VibeBundle { asset_ids } => {
                for id in asset_ids {
                    self.require_asset(id, AssetKind::VibeDocument)?;
                }
            },
            AssetSource::Import { .. } => {},
        }
        Ok(())
    }
}

fn prepare_thumbnail(
    image: &EncodedImage,
) -> Result<novelai_bridge::PreparedImage, PersistenceError> {
    let pixels = image.pixels().thumbnail(256, 256);
    novelai_bridge::PreparedImage::from_pixels(&pixels)
        .map_err(|error| PersistenceError::failure("encode a media thumbnail", error))
}

#[cfg(test)]
mod tests;

impl AssetReader for MediaLibrary {
    fn image(&self, id: &str) -> Result<EncodedImage, PersistenceError> {
        let asset = self.asset(id)?;
        self.image_content(&asset)
    }

    fn vibe(&self, id: &str) -> Result<VibeEncoding, PersistenceError> {
        let asset = self.asset(id)?;
        self.vibe_content(&asset)
    }
}

impl MediaLibrary {
    pub(super) fn image_content(
        &self,
        asset: &MediaAsset,
    ) -> Result<EncodedImage, PersistenceError> {
        if asset.kind != AssetKind::Image {
            return Err(wrong_kind(&asset.id, AssetKind::Image));
        }
        EncodedImage::from_bytes(self.content(asset)?.bytes)
            .map_err(|error| PersistenceError::failure("validate retained image content", error))
    }

    pub(super) fn vibe_content(
        &self,
        asset: &MediaAsset,
    ) -> Result<VibeEncoding, PersistenceError> {
        if asset.kind != AssetKind::Vibe {
            return Err(wrong_kind(&asset.id, AssetKind::Vibe));
        }
        VibeEncoding::from_bytes(self.content(asset)?.bytes)
            .map_err(|error| PersistenceError::failure("validate retained Vibe content", error))
    }
}

fn next_asset_id() -> Result<String, PersistenceError> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| PersistenceError::failure("create a media identity", error))?
        .as_nanos();
    Ok(format!(
        "asset-{nanos}-{}",
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}

fn wrong_kind(id: &str, expected: AssetKind) -> PersistenceError {
    PersistenceError::InvalidData {
        message: format!("媒体 {id} 不是所需的 {expected:?} 内容。"),
    }
}

fn image_format(bytes: &[u8]) -> ImageMediaFormat {
    // EncodedImage already guarantees one of the SDK-supported PNG/JPEG/WebP formats.
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        ImageMediaFormat::Png
    } else if bytes.starts_with(b"\xff\xd8") {
        ImageMediaFormat::Jpeg
    } else {
        ImageMediaFormat::WebP
    }
}

pub(super) fn embedded_vibe_encodings(
    id: &str,
    metadata: &novelai_bridge::ImageMetadata,
) -> Result<Vec<(VibeEncoding, AssetSource)>, PersistenceError> {
    let mut encodings = Vec::new();
    for (entry_index, entry) in metadata.vibe_entries.iter().enumerate() {
        let payloads = entry
            .encoding
            .iter()
            .map(|value| (None, None, value))
            .chain(entry.model_encodings.iter().flat_map(|(model, records)| {
                records.iter().map(move |(parameter_key, value)| {
                    (Some(model.clone()), Some(parameter_key.clone()), value)
                })
            }));
        for (model, parameter_key, payload) in payloads {
            let encoding = VibeEncoding::from_base64(payload).map_err(|error| {
                PersistenceError::failure("decode an embedded Vibe encoding", error)
            })?;
            encodings.push((
                encoding,
                AssetSource::EmbeddedVibe {
                    asset_id: id.to_owned(),
                    entry_index,
                    model,
                    parameter_key,
                    display_name: entry.display_name.clone(),
                    strength: entry.strength,
                    information_extracted: entry.information_extracted,
                },
            ));
        }
    }
    Ok(encodings)
}

//! Official Vibe documents keep their complete local representation alongside usable assets.

use novelai_bridge::{EncodedImage, PngTextEntry, VibeBundle, VibeDocument, VibeFile};
use serde::Serialize;

use super::{AssetKind, AssetReader, AssetSource, MediaAsset, MediaContent, MediaLibrary};
use crate::{
    api::UserMessage,
    jobs::{FrozenSubmission, JobStore as _},
    persistence::PersistenceError,
    session::VibeEncodingInput,
};

/// Small inspection views never send encoded payload strings to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct VibeDocumentInspection {
    pub asset_id: String,
    pub is_bundle: bool,
    pub entries: Vec<VibeDocumentEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct VibeDocumentEntry {
    pub entry_index: usize,
    pub id: String,
    pub name: Option<String>,
    pub has_image: bool,
    pub caches: Vec<VibeCacheSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct VibeCacheSummary {
    pub model_key: String,
    pub parameter_key: String,
    pub information_extracted: Option<f64>,
    pub has_mask: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct VibeAssetInspection {
    pub asset_id: String,
    pub model_key: Option<String>,
    pub parameter_key: Option<String>,
    pub source_image_asset_id: Option<String>,
    pub has_source_image: bool,
    pub source_document: Option<VibeSourceDocument>,
    pub can_reencode: bool,
    pub information_extracted: Option<f64>,
    pub encoding_input: Option<VibeEncodingInput>,
    pub can_export_document: bool,
}

/// A retained document or PNG containing the original, without a derived image asset.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct VibeSourceDocument {
    pub asset_id: String,
    pub entry_index: usize,
}

impl MediaLibrary {
    /// Creates an official image Vibe file from an existing immutable image asset.
    ///
    /// # Errors
    /// Returns unavailable/invalid image content or document storage failures.
    pub fn create_image_vibe_document(
        &self,
        image_id: &str,
    ) -> Result<MediaAsset, PersistenceError> {
        let asset = self.asset(image_id)?;
        let image = self.image_content(&asset)?;
        let file = self
            .source_vibe_file(&asset.source)?
            .unwrap_or_else(|| VibeFile::image(image.to_base64()));
        self.retain_vibe_document(
            &VibeDocument::Single(Box::new(file)),
            AssetSource::Asset {
                asset_id: image_id.to_owned(),
            },
        )
    }

    /// Creates an official encoding Vibe file from a local encoding or job output.
    ///
    /// # Errors
    /// Returns unavailable/invalid encoding content or document storage failures.
    pub fn create_encoded_vibe_document(
        &self,
        vibe_id: &str,
    ) -> Result<MediaAsset, PersistenceError> {
        let file = self.encoded_vibe_file(vibe_id)?;
        self.retain_vibe_document(
            &VibeDocument::Single(Box::new(file)),
            AssetSource::Asset {
                asset_id: vibe_id.to_owned(),
            },
        )
    }

    /// Lists every stored cache identity without selecting or materializing content.
    ///
    /// # Errors
    /// Returns unavailable or invalid retained documents.
    pub fn inspect_vibe_document(
        &self,
        id: &str,
    ) -> Result<VibeDocumentInspection, PersistenceError> {
        let document = self.read_vibe_document(id)?;
        Ok(document_inspection(id, &document))
    }

    /// Explains known encoding provenance without guessing missing model identities.
    ///
    /// # Errors
    /// Returns unavailable encodings or source records.
    pub fn inspect_vibe_asset(&self, id: &str) -> Result<VibeAssetInspection, PersistenceError> {
        let asset = self.asset(id)?;
        self.vibe_content(&asset)?;
        self.inspect_vibe_source(&asset).map(|(view, _)| view)
    }

    fn inspect_vibe_source(
        &self,
        asset: &MediaAsset,
    ) -> Result<(VibeAssetInspection, Option<VibeFile>), PersistenceError> {
        let id = &asset.id;
        let mut source_file = None;
        let mut view = VibeAssetInspection {
            asset_id: id.to_owned(),
            model_key: None,
            parameter_key: None,
            source_image_asset_id: None,
            has_source_image: false,
            source_document: None,
            can_reencode: false,
            information_extracted: None,
            encoding_input: None,
            can_export_document: false,
        };
        match &asset.source {
            AssetSource::Job { job_id } => {
                if let FrozenSubmission::EncodeVibe {
                    asset_id,
                    model,
                    information_extracted,
                    mask_asset_id,
                    crop_to_mask,
                    focus_seed,
                    info_extract_seed,
                    ..
                } = self.database.get_job(job_id)?.submission
                {
                    view.model_key = model.vibe_model_key().map(str::to_owned);
                    view.parameter_key = Some("unknown".to_owned());
                    view.source_image_asset_id = Some(asset_id.clone());
                    view.information_extracted = Some(f64::from(information_extracted));
                    let source_available = self.asset(&asset_id)?.available;
                    view.has_source_image = source_available;
                    let mask_available = mask_asset_id
                        .as_deref()
                        .map(|id| self.asset(id).map(|asset| asset.available))
                        .transpose()?
                        .unwrap_or(true);
                    if source_available && mask_available {
                        view.encoding_input = Some(VibeEncodingInput {
                            asset_id,
                            model,
                            information_extracted,
                            mask_asset_id,
                            crop_to_mask,
                            focus_seed,
                            info_extract_seed,
                        });
                    }
                    view.can_export_document = view.model_key.is_some();
                    view.can_reencode = view.encoding_input.is_some();
                }
            },
            AssetSource::VibeDocumentEntry {
                asset_id,
                entry_index,
                model,
                parameter_key,
            } => {
                view.model_key.clone_from(model);
                view.parameter_key.clone_from(parameter_key);
                let document = self.read_vibe_document(asset_id)?;
                let file = document_file(&document, asset_id, *entry_index)?;
                inspect_document_source(&mut view, &file, asset_id, *entry_index);
                source_file = Some(file);
            },
            AssetSource::EmbeddedVibe {
                asset_id,
                entry_index,
                model,
                parameter_key,
                information_extracted,
                ..
            } => {
                view.model_key.clone_from(model);
                view.parameter_key.clone_from(parameter_key);
                view.information_extracted = information_extracted.map(f64::from);
                view.can_export_document = model.is_some();
                if let Some(file) = self.source_vibe_file(&asset.source)? {
                    inspect_document_source(&mut view, &file, asset_id, *entry_index);
                    source_file = Some(file);
                }
            },
            _ => {},
        }
        Ok((view, source_file))
    }

    fn encoded_vibe_file(&self, id: &str) -> Result<VibeFile, PersistenceError> {
        let asset = self.asset(id)?;
        let encoding = self.vibe_content(&asset)?;
        if let Some(file) = self.source_vibe_file(&asset.source)? {
            return Ok(file);
        }
        let input = match &asset.source {
            AssetSource::Job { job_id } => match self.database.get_job(job_id)?.submission {
                FrozenSubmission::EncodeVibe {
                    asset_id,
                    model,
                    information_extracted,
                    mask_asset_id,
                    ..
                } => model.vibe_model_key().map(|model| {
                    (
                        Some(asset_id),
                        model.to_owned(),
                        Some(f64::from(information_extracted)),
                        mask_asset_id,
                    )
                }),
                _ => None,
            },
            AssetSource::EmbeddedVibe {
                model: Some(model),
                information_extracted,
                ..
            } => Some((
                None,
                model.clone(),
                information_extracted.map(f64::from),
                None,
            )),
            _ => None,
        };
        let (source_id, model, information_extracted, mask_id) =
            input.ok_or_else(|| PersistenceError::InvalidData {
                message: UserMessage::VibeModelUnknown,
            })?;
        let mut file = VibeFile::encoded(&model, encoding.to_base64());
        let record = &mut file
            .encodings
            .get_mut(&model)
            .expect("the SDK constructor retains its model key")["unknown"];
        record.params = Some(novelai_bridge::VibeEncodingParams {
            information_extracted,
            mask: mask_id
                .as_deref()
                .map(|id| self.image(id).map(|image| image.to_base64()))
                .transpose()?,
        });
        if let AssetSource::EmbeddedVibe {
            parameter_key: Some(key),
            ..
        } = &asset.source
            && key != "unknown"
        {
            let records = file
                .encodings
                .get_mut(&model)
                .expect("the SDK constructor retains its model key");
            let record = records
                .shift_remove("unknown")
                .expect("the SDK constructor creates the unknown parameter key");
            records.insert(key.clone(), record);
        }
        file.image = source_id
            .as_deref()
            .map(|id| {
                let source = self.asset(id)?;
                if source.available {
                    self.image_content(&source)
                        .map(|image| Some(image.to_base64()))
                } else {
                    Ok(None)
                }
            })
            .transpose()?
            .flatten();
        Ok(file)
    }

    fn source_vibe_file(&self, source: &AssetSource) -> Result<Option<VibeFile>, PersistenceError> {
        match source {
            AssetSource::VibeDocumentEntry {
                asset_id,
                entry_index,
                ..
            } => {
                let document = self.read_vibe_document(asset_id)?;
                document_file(&document, asset_id, *entry_index).map(Some)
            },
            AssetSource::EmbeddedVibe {
                asset_id,
                entry_index,
                ..
            } => {
                let asset = self.asset(asset_id)?;
                if asset.mime_type != "image/png" || !asset.available {
                    return Ok(None);
                }
                let content = self.content(&asset)?;
                let metadata = novelai_bridge::inspect_generated_image_metadata(
                    &content.bytes,
                    Some(&content.mime_type),
                );
                let Some(document_index) = metadata.parsed().and_then(|metadata| {
                    embedded_document_index(&metadata.vibe_entries, *entry_index)
                }) else {
                    return Ok(None);
                };
                VibeDocument::from_png(&content.bytes)
                    .map_err(|error| {
                        PersistenceError::failure("read the source Vibe document from PNG", error)
                    })?
                    .map(|document| document_file(&document, asset_id, document_index))
                    .transpose()
            },
            _ => Ok(None),
        }
    }

    /// Combines complete files in the selected document order, retaining every cache.
    ///
    /// # Errors
    /// Returns unavailable documents, SDK bundle validation or storage failures.
    pub fn bundle_vibe_documents(
        &self,
        document_ids: &[String],
    ) -> Result<MediaAsset, PersistenceError> {
        let mut files = Vec::new();
        for id in document_ids {
            files.extend_from_slice(self.read_vibe_document(id)?.files());
        }
        self.retain_vibe_document(
            &VibeDocument::Bundle(VibeBundle::new(files)),
            AssetSource::VibeBundle {
                asset_ids: document_ids.to_vec(),
            },
        )
    }

    /// Validates and retains an official Vibe file or bundle, including every cache record.
    ///
    /// # Errors
    /// Returns SDK document validation or durable storage failures.
    pub fn import_vibe_document(
        &self,
        bytes: &[u8],
        source: AssetSource,
    ) -> Result<MediaAsset, PersistenceError> {
        let document = VibeDocument::from_json(bytes).map_err(|error| {
            PersistenceError::failure("validate an imported Vibe document", error)
        })?;
        self.retain_vibe_document(&document, source)
    }

    /// Imports an official document embedded in a retained PNG without dropping its images.
    ///
    /// # Errors
    /// Returns invalid PNG/document data or storage failures. Absence is `None`.
    pub fn import_png_vibe_document(
        &self,
        image_id: &str,
    ) -> Result<Option<MediaAsset>, PersistenceError> {
        let image = self.image(image_id)?;
        let document = VibeDocument::from_png(image.as_bytes()).map_err(|error| {
            PersistenceError::failure("read an official Vibe document from PNG", error)
        })?;
        document
            .map(|document| {
                self.retain_vibe_document(
                    &document,
                    AssetSource::Asset {
                        asset_id: image_id.to_owned(),
                    },
                )
            })
            .transpose()
    }

    /// Reads a full SDK document; selecting a cache remains an explicit separate operation.
    ///
    /// # Errors
    /// Returns unknown/unavailable document assets or SDK parsing failures.
    pub fn read_vibe_document(&self, id: &str) -> Result<VibeDocument, PersistenceError> {
        let asset = self.asset(id)?;
        if asset.kind != AssetKind::VibeDocument || !asset.available {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::MediaUnavailable { id: id.to_owned() },
            });
        }
        VibeDocument::from_json(&self.content(&asset)?.bytes)
            .map_err(|error| PersistenceError::failure("read a retained Vibe document", error))
    }

    /// Exports a validated official `.naiv4vibe` or `.naiv4vibebundle` JSON document.
    ///
    /// # Errors
    /// Returns unavailable content or SDK document validation/serialization failures.
    pub fn export_vibe_document(&self, id: &str) -> Result<MediaContent, PersistenceError> {
        let bytes = self.read_vibe_document(id)?.to_json().map_err(|error| {
            PersistenceError::failure("export an official Vibe document", error)
        })?;
        Ok(MediaContent {
            mime_type: "application/json".to_owned(),
            bytes,
        })
    }

    /// Materializes one document image as an independent immutable application asset.
    ///
    /// # Errors
    /// Returns missing document entries/images, invalid SDK image data or storage failures.
    pub fn import_document_image(
        &self,
        document_id: &str,
        entry_index: usize,
    ) -> Result<MediaAsset, PersistenceError> {
        let document = self.read_vibe_document(document_id)?;
        let image = document
            .files()
            .get(entry_index)
            .and_then(|file| file.image.as_deref())
            .ok_or_else(|| missing_document_content(document_id, entry_index, "image"))?;
        let image = EncodedImage::from_base64(image)
            .map_err(|error| PersistenceError::failure("decode a Vibe document image", error))?;
        self.retain_image(
            &image,
            AssetSource::VibeDocumentEntry {
                asset_id: document_id.to_owned(),
                entry_index,
                model: None,
                parameter_key: None,
            },
        )
    }

    /// Materializes one selected model/parameter cache record, retaining both cache keys.
    ///
    /// # Errors
    /// Returns missing cache entries, SDK encoding validation or storage failures.
    pub fn import_document_encoding(
        &self,
        document_id: &str,
        entry_index: usize,
        model_key: &str,
        parameter_key: &str,
    ) -> Result<MediaAsset, PersistenceError> {
        let document = self.read_vibe_document(document_id)?;
        let file = document
            .files()
            .get(entry_index)
            .ok_or_else(|| missing_document_content(document_id, entry_index, "entry"))?;
        let encoding = file
            .encoding(model_key, parameter_key)
            .map_err(|error| {
                PersistenceError::failure("select a Vibe document cache record", error)
            })?
            .ok_or_else(|| missing_document_content(document_id, entry_index, "encoding cache"))?;
        self.retain_vibe(
            &encoding,
            AssetSource::VibeDocumentEntry {
                asset_id: document_id.to_owned(),
                entry_index,
                model: Some(model_key.to_owned()),
                parameter_key: Some(parameter_key.to_owned()),
            },
        )
    }

    /// Creates a derived PNG with the complete official document embedded in `naidata`.
    ///
    /// # Errors
    /// Returns unavailable inputs, SDK PNG/document validation or storage failures.
    pub fn embed_vibe_document(
        &self,
        document_id: &str,
        image_id: &str,
    ) -> Result<MediaAsset, PersistenceError> {
        let document = self.read_vibe_document(document_id)?;
        let image = self.image(image_id)?;
        let bytes = document.embed_in_png(image.as_bytes()).map_err(|error| {
            PersistenceError::failure("embed an official Vibe document in PNG", error)
        })?;
        self.import_image(
            bytes,
            AssetSource::PngVibeDocument {
                image_asset_id: image_id.to_owned(),
                document_asset_id: document_id.to_owned(),
            },
        )
    }

    /// Replaces PNG text through the SDK and retains a new asset linked to the original.
    ///
    /// # Errors
    /// Returns unavailable inputs, SDK text/PNG validation or storage failures.
    pub fn write_png_text(
        &self,
        image_id: &str,
        entries: &[PngTextEntry],
    ) -> Result<MediaAsset, PersistenceError> {
        let image = self.image(image_id)?;
        let bytes = novelai_bridge::write_png_text_chunks(image.as_bytes(), entries)
            .map_err(|error| PersistenceError::failure("write retained PNG text", error))?;
        self.import_image(
            bytes,
            AssetSource::Asset {
                asset_id: image_id.to_owned(),
            },
        )
    }

    fn retain_vibe_document(
        &self,
        document: &VibeDocument,
        source: AssetSource,
    ) -> Result<MediaAsset, PersistenceError> {
        self.validate_source(&source)?;
        let bytes = document.to_json().map_err(|error| {
            PersistenceError::failure("serialize a retained Vibe document", error)
        })?;
        let asset = self.stage_asset(
            AssetKind::VibeDocument,
            "application/json",
            &bytes,
            None,
            source,
        )?;
        self.database.insert_asset(&asset)?;
        Ok(asset)
    }
}

fn missing_document_content(id: &str, entry_index: usize, kind: &str) -> PersistenceError {
    PersistenceError::InvalidData {
        message: UserMessage::VibeDocumentContentMissing {
            id: id.to_owned(),
            entry_index,
            content: kind.to_owned(),
        },
    }
}

fn document_file(
    document: &VibeDocument,
    id: &str,
    entry_index: usize,
) -> Result<VibeFile, PersistenceError> {
    document
        .files()
        .get(entry_index)
        .cloned()
        .ok_or_else(|| missing_document_content(id, entry_index, "entry"))
}

fn encoding_model(key: Option<&str>) -> Option<novelai_bridge::Model> {
    novelai_bridge::Model::ALL
        .into_iter()
        .find(|model| model.descriptor().can_encode_vibe() && model.vibe_model_key() == key)
}

fn embedded_document_index(
    entries: &[novelai_bridge::VibeMetadataEntry],
    entry_index: usize,
) -> Option<usize> {
    let entry = entries.get(entry_index)?;
    if entry.source != novelai_bridge::VibeMetadataSource::NaiDataChunk {
        return None;
    }
    Some(
        entries[..entry_index]
            .iter()
            .filter(|entry| entry.source == novelai_bridge::VibeMetadataSource::NaiDataChunk)
            .count(),
    )
}

fn inspect_document_source(
    view: &mut VibeAssetInspection,
    file: &VibeFile,
    id: &str,
    entry_index: usize,
) {
    view.information_extracted = view
        .model_key
        .as_deref()
        .and_then(|model| file.encodings.get(model))
        .and_then(|records| {
            view.parameter_key
                .as_deref()
                .and_then(|key| records.get(key))
        })
        .and_then(|record| record.params.as_ref())
        .and_then(|params| params.information_extracted);
    view.has_source_image = file.image.as_ref().is_some_and(|image| !image.is_empty());
    view.source_document = Some(VibeSourceDocument {
        asset_id: id.to_owned(),
        entry_index,
    });
    view.can_reencode =
        view.has_source_image && encoding_model(view.model_key.as_deref()).is_some();
    view.can_export_document = true;
}

fn document_inspection(id: &str, document: &VibeDocument) -> VibeDocumentInspection {
    VibeDocumentInspection {
        asset_id: id.to_owned(),
        is_bundle: matches!(document, VibeDocument::Bundle(_)),
        entries: document
            .files()
            .iter()
            .enumerate()
            .map(|(entry_index, file)| VibeDocumentEntry {
                entry_index,
                id: file.id.clone(),
                name: file.name.clone(),
                has_image: file.image.is_some(),
                caches: file
                    .encodings
                    .iter()
                    .flat_map(|(model, records)| {
                        records.iter().map(move |(key, record)| VibeCacheSummary {
                            model_key: model.clone(),
                            parameter_key: key.clone(),
                            information_extracted: record
                                .params
                                .as_ref()
                                .and_then(|params| params.information_extracted),
                            has_mask: record
                                .params
                                .as_ref()
                                .is_some_and(|params| params.mask.is_some()),
                        })
                    })
                    .collect(),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests;

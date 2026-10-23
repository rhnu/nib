//! Official Vibe documents keep their complete local representation alongside usable assets.

use novelai_bridge::{EncodedImage, PngTextEntry, VibeBundle, VibeDocument, VibeFile};
use serde::Serialize;

use super::{AssetKind, AssetReader, AssetSource, MediaAsset, MediaContent, MediaLibrary};
use crate::{
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
        let image = self.image(image_id)?;
        let file = self
            .source_vibe_file(&self.asset(image_id)?.source)?
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
        self.vibe(id)?;
        let asset = self.asset(id)?;
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
                }
            },
            _ => {},
        }
        Ok(view)
    }

    fn encoded_vibe_file(&self, id: &str) -> Result<VibeFile, PersistenceError> {
        let asset = self.asset(id)?;
        self.vibe(id)?;
        if let Some(file) = self.source_vibe_file(&asset.source)? {
            return Ok(file);
        }
        let view = self.inspect_vibe_asset(id)?;
        let model = view
            .model_key
            .ok_or_else(|| PersistenceError::InvalidData {
                message: "编码没有已知模型身份，无法创建官方 Vibe 文档；请导出原始编码。"
                    .to_owned(),
            })?;
        let mut file = VibeFile::encoded(&model, self.vibe(id)?.to_base64());
        let key = view.parameter_key.as_deref().unwrap_or("unknown");
        let mut record = file.encodings[&model]["unknown"].clone();
        let mask_id = if let AssetSource::Job { job_id } = &asset.source {
            if let FrozenSubmission::EncodeVibe { mask_asset_id, .. } =
                self.database.get_job(job_id)?.submission
            {
                mask_asset_id
            } else {
                None
            }
        } else {
            None
        };
        record.params = Some(novelai_bridge::VibeEncodingParams {
            information_extracted: view.information_extracted,
            mask: mask_id
                .as_deref()
                .map(|id| self.image(id).map(|image| image.to_base64()))
                .transpose()?,
        });
        file.encodings
            .insert(model, [(key.to_owned(), record)].into_iter().collect());
        file.image = if view.has_source_image {
            view.source_image_asset_id
                .as_deref()
                .map(|id| self.image(id).map(|image| image.to_base64()))
                .transpose()?
        } else {
            None
        };
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
                let metadata = self.inspect_sdk_metadata(asset_id)?;
                let Some(document_index) = metadata.parsed().and_then(|metadata| {
                    embedded_document_index(&metadata.vibe_entries, *entry_index)
                }) else {
                    return Ok(None);
                };
                let image = self.image(asset_id)?;
                VibeDocument::from_png(image.as_bytes())
                    .map_err(|error| {
                        PersistenceError::failure("read the source Vibe document from PNG", error)
                    })?
                    .map(|document| document_file(&document, asset_id, document_index))
                    .transpose()
            },
            _ => Ok(None),
        }
    }

    /// Materializes retained source content only after an explicit request to edit encoding.
    ///
    /// # Errors
    /// Returns unavailable source media, unrecognized model identity or invalid embedded images.
    pub fn prepare_vibe_reencoding(&self, id: &str) -> Result<VibeEncodingInput, PersistenceError> {
        let view = self.inspect_vibe_asset(id)?;
        if let Some(input) = view.encoding_input {
            return Ok(input);
        }
        let source = self.asset(id)?.source;
        let file =
            self.source_vibe_file(&source)?
                .ok_or_else(|| PersistenceError::InvalidData {
                    message: "编码未保留可用原图，无法重新编码。".to_owned(),
                })?;
        let material = reencoding_material(
            &file,
            view.model_key.as_deref(),
            view.parameter_key.as_deref(),
        )?;
        let image = self.import_image(material.image.as_bytes().to_vec(), source)?;
        let mask = material
            .mask
            .map(|mask| {
                self.import_image(
                    mask.as_bytes().to_vec(),
                    AssetSource::Asset {
                        asset_id: id.to_owned(),
                    },
                )
            })
            .transpose()?;
        let mut input = crate::session::create_vibe_encoding_input(self, image.id, material.model)?;
        if let Some(extraction) = material.information_extracted {
            input.information_extracted = extraction;
        }
        input.mask_asset_id = mask.map(|asset| asset.id);
        Ok(input)
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
        self.require_asset(id, AssetKind::VibeDocument)?;
        VibeDocument::from_json(&self.read_asset(id)?.bytes)
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
        self.import_image(
            image.as_bytes().to_vec(),
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
        self.import_vibe(
            encoding.as_bytes().to_vec(),
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
        message: format!("Vibe 文档 {id} 的第 {entry_index} 项没有所需的 {kind}。"),
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

struct ReencodingMaterial {
    model: novelai_bridge::Model,
    image: EncodedImage,
    mask: Option<EncodedImage>,
    information_extracted: Option<f32>,
}

fn reencoding_material(
    file: &VibeFile,
    model_key: Option<&str>,
    parameter_key: Option<&str>,
) -> Result<ReencodingMaterial, PersistenceError> {
    let model = encoding_model(model_key).ok_or_else(|| PersistenceError::InvalidData {
        message: "编码的模型身份没有对应的 SDK 编码能力，请另行选择原图和模型。".to_owned(),
    })?;
    let image = file
        .image
        .as_deref()
        .ok_or_else(|| PersistenceError::InvalidData {
            message: "Vibe 文档没有原图，无法重新编码。".to_owned(),
        })?;
    let image = EncodedImage::from_base64(image).map_err(|error| {
        PersistenceError::failure("decode the retained Vibe source image", error)
    })?;
    let record = model_key
        .and_then(|key| file.encodings.get(key))
        .and_then(|records| parameter_key.and_then(|key| records.get(key)))
        .ok_or_else(|| PersistenceError::InvalidData {
            message: "Vibe 文档缺少所选编码缓存。".to_owned(),
        })?;
    let params = record.params.as_ref();
    let mask = params
        .and_then(|params| params.mask.as_deref())
        .map(EncodedImage::from_base64)
        .transpose()
        .map_err(|error| PersistenceError::failure("decode the retained Vibe mask", error))?;
    let information_extracted: Option<f32> = params
        .and_then(|params| params.information_extracted)
        .map(|value| serde_json::from_value(serde_json::json!(value)))
        .transpose()
        .map_err(|error| {
            PersistenceError::failure("read Vibe extraction for the SDK encoder", error)
        })?;
    if information_extracted.is_some_and(|value| !value.is_finite()) {
        return Err(PersistenceError::InvalidData {
            message: "文档信息提取量无法表示为编码输入。".to_owned(),
        });
    }
    Ok(ReencodingMaterial {
        model,
        image,
        mask,
        information_extracted,
    })
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

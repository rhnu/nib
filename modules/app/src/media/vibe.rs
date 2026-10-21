//! Official Vibe documents keep their complete local representation alongside usable assets.

use novelai_bridge::{EncodedImage, PngTextEntry, VibeBundle, VibeDocument, VibeFile};

use super::{AssetKind, AssetReader, AssetSource, MediaAsset, MediaContent, MediaLibrary};
use crate::persistence::PersistenceError;

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
        self.retain_vibe_document(
            &VibeDocument::Single(Box::new(VibeFile::image(image.to_base64()))),
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
        model_key: &str,
    ) -> Result<MediaAsset, PersistenceError> {
        let encoding = self.vibe(vibe_id)?;
        self.retain_vibe_document(
            &VibeDocument::Single(Box::new(VibeFile::encoded(model_key, encoding.to_base64()))),
            AssetSource::Asset {
                asset_id: vibe_id.to_owned(),
            },
        )
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

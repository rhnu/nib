//! Materializes official reference archives using the application's immutable media identities.

use novelai_bridge::{
    CharacterReference, ImageDecodePolicy, ImageLimit, PreciseReferenceDocument,
    PreciseReferenceEntry,
};

use super::{AssetSource, MediaLibrary};
use crate::{persistence::PersistenceError, session::PreciseReferenceInput};

impl MediaLibrary {
    /// Retains all original images together and returns editable reference entries in ZIP order.
    ///
    /// # Errors
    /// Returns a failure if the media cannot be staged or retained.
    pub fn import_precise_references(
        &self,
        document: PreciseReferenceDocument,
    ) -> Result<Vec<PreciseReferenceInput>, PersistenceError> {
        let mut references = Vec::with_capacity(document.entries.len());
        let mut assets = Vec::with_capacity(document.entries.len());
        for entry in document.entries {
            let asset = self.stage_image_asset(
                &entry.reference.image,
                AssetSource::Import {
                    name: Some(entry.filename),
                },
            )?;
            references.push(PreciseReferenceInput {
                id: uuid::Uuid::new_v4().to_string(),
                enabled: entry.enabled,
                asset_id: asset.id.clone(),
                reference_type: entry.reference.reference_type,
                strength: entry.reference.strength,
                fidelity: entry.reference.fidelity,
                information_extracted: entry.reference.information_extracted,
            });
            assets.push(asset);
        }
        self.database.insert_assets(&assets)?;
        Ok(references)
    }

    /// Exports the original image bytes and current editor settings, including disabled entries.
    ///
    /// # Errors
    /// Returns unavailable media, incompatible media, budget or ZIP encoding failures.
    pub fn export_precise_references(
        &self,
        references: &[PreciseReferenceInput],
    ) -> Result<Vec<u8>, PersistenceError> {
        let policy = ImageDecodePolicy::default();
        let budget_error =
            |error| PersistenceError::failure("budget a precise reference ZIP", error);
        policy
            .check(ImageLimit::Images, references.len() as u64)
            .and_then(|()| policy.check(ImageLimit::ArchiveEntries, references.len() as u64 + 1))
            .map_err(budget_error)?;
        let mut encoded_bytes = 0_u64;
        let mut decoded_bytes = 0_u64;
        let mut entries = Vec::with_capacity(references.len());
        for reference in references {
            let asset = self.asset(&reference.asset_id)?;
            let image = self.input_image_content(&asset)?;
            // Limit retained media while assembling the input to the SDK archive writer.
            encoded_bytes = encoded_bytes.saturating_add(image.as_bytes().len() as u64);
            decoded_bytes = decoded_bytes.saturating_add(image.pixels().as_bytes().len() as u64);
            policy
                .check(ImageLimit::TotalImageBytes, encoded_bytes)
                .and_then(|()| policy.check(ImageLimit::DecodedBytes, decoded_bytes))
                .map_err(budget_error)?;
            let filename = match asset.source {
                AssetSource::Import { name } => name.unwrap_or_default(),
                _ => String::new(),
            };
            entries.push(PreciseReferenceEntry {
                filename,
                enabled: reference.enabled,
                reference: CharacterReference {
                    image,
                    reference_type: reference.reference_type,
                    strength: reference.strength,
                    fidelity: reference.fidelity,
                    information_extracted: reference.information_extracted,
                },
            });
        }
        PreciseReferenceDocument { entries }
            .to_bytes_with_policy(policy)
            .map_err(|error| PersistenceError::failure("encode a precise reference ZIP", error))
    }
}

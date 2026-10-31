use super::{AssetKind, MediaLibrary};
use crate::{
    persistence::PersistenceError,
    safety::{ImageSafety, ScanOutcome},
};

impl MediaLibrary {
    /// Reads the assessment shared by all assets with identical immutable image bytes.
    /// # Errors
    /// Returns missing images, incompatible kinds or storage failures.
    pub fn image_safety(&self, asset_id: &str) -> Result<ImageSafety, PersistenceError> {
        let asset = self.asset(asset_id)?;
        if asset.kind != AssetKind::Image {
            return Err(PersistenceError::InvalidData {
                message: crate::api::UserMessage::VibeIsNotImage,
            });
        }
        self.database.image_safety(asset_id, &asset.blob_id)
    }

    /// Runs a manual or automatic assessment, retaining old evidence when inference is unavailable.
    /// # Errors
    /// Returns media access, configuration or evidence persistence failures.
    pub fn scan_image_safety(
        &self,
        asset_id: &str,
        manual: bool,
    ) -> Result<ImageSafety, PersistenceError> {
        let asset = self.asset(asset_id)?;
        if asset.kind != AssetKind::Image {
            return Err(PersistenceError::InvalidData {
                message: crate::api::UserMessage::VibeIsNotImage,
            });
        }
        let outcome = match &self.safety_scanner {
            Some(scanner) => match self.content(&asset) {
                Ok(content) => scanner.scan(&content.bytes, manual)?,
                Err(error) => {
                    tracing::warn!(asset_id, error=?error, "image safety source is unavailable");
                    ScanOutcome::unknown(format!(
                        "imageUnavailable: {}",
                        crate::api::error_detail(&error)
                    ))
                },
            },
            None => ScanOutcome::unknown("modelUnavailable"),
        };
        self.database.save_image_safety(&asset.blob_id, &outcome)?;
        self.database.image_safety(asset_id, &asset.blob_id)
    }
}

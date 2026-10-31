//! Resource-owned images reuse immutable media storage without retaining a source relationship.
use novelai_bridge::EncodedImage;
use rusqlite::Connection;

use super::{
    AssetKind, AssetSource, MediaAsset, MediaLibrary,
    sqlite::{insert_asset, read_asset_on},
};
use crate::{
    library::{
        ResourceBatchAction, ResourceImpact, ResourceSelection,
        operations::{batch_on, impact_on},
    },
    persistence::PersistenceError,
    prompt::{
        Resource,
        sqlite::{get_resource, save_resource_on},
    },
};

impl MediaLibrary {
    /// Imports a pending cover directly into exclusive resource storage.
    /// # Errors
    /// Returns invalid identity/image data or durable storage failures.
    pub fn import_resource_cover(
        &self,
        resource_id: &str,
        bytes: Vec<u8>,
    ) -> Result<MediaAsset, PersistenceError> {
        crate::library::validate_id(resource_id)?;
        let image = EncodedImage::from_bytes(bytes)
            .map_err(|error| PersistenceError::failure("validate a resource cover", error))?;
        self.retain_image(
            &image,
            AssetSource::ResourceCover {
                resource_id: resource_id.to_owned(),
            },
        )
    }

    /// Discards only a pending cover that has not been adopted by a saved resource.
    /// # Errors
    /// Rejects another owner's image, an adopted cover or storage failures.
    pub fn discard_resource_cover(
        &self,
        resource_id: &str,
        asset_id: &str,
    ) -> Result<(), PersistenceError> {
        crate::library::validate_id(resource_id)?;
        let mut connection = self.database.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin pending cover discard", error))?;
        let adopted = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM resources WHERE cover_asset_id=?1)",
                [asset_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| PersistenceError::failure("inspect pending cover ownership", error))?;
        if adopted {
            return Err(PersistenceError::Conflict {
                kind: "resource cover",
                id: asset_id.into(),
            });
        }
        let removed = remove_cover_on(&transaction, asset_id, resource_id)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("discard pending cover", error))?;
        drop(connection);
        if removed {
            self.clean_cover_files(&[asset_id.to_owned()]);
        }
        Ok(())
    }

    /// Copies exclusive cover bytes when an explicit action reuses them as ordinary input.
    /// # Errors
    /// Returns unavailable input images or a failure to retain an independent copy.
    pub fn independent_input_id(&self, id: &str) -> Result<String, PersistenceError> {
        let asset = self.asset(id)?;
        if !matches!(asset.source, AssetSource::ResourceCover { .. }) {
            return Ok(id.to_owned());
        }
        let image = self.image_content(&asset)?;
        Ok(self
            .retain_image(&image, AssetSource::Import { name: None })?
            .id)
    }

    fn stage_resource_cover(
        &self,
        connection: &Connection,
        id: &str,
        resource_id: &str,
    ) -> Result<MediaAsset, PersistenceError> {
        let source = read_asset_on(connection, id)?;
        let image = self.image_content(&source)?;
        self.stage_asset(
            AssetKind::Image,
            &source.mime_type,
            image.as_bytes(),
            Some((image.size().width, image.size().height)),
            AssetSource::ResourceCover {
                resource_id: resource_id.into(),
            },
        )
    }

    /// Saves metadata and a copied image in one transaction. Failed CAS writes discard staged copies.
    /// # Errors
    /// Returns invalid metadata, revision conflicts, unavailable source images or storage failures.
    pub fn save_resource_with_cover(
        &self,
        resource: &Resource,
    ) -> Result<Resource, PersistenceError> {
        let mut staged = Vec::new();
        let mut removed = Vec::new();
        let result = (|| {
            let mut connection = self.database.connection()?;
            let transaction = connection.transaction().map_err(|error| {
                PersistenceError::failure("begin resource and cover save", error)
            })?;
            let previous = get_resource(&transaction, &resource.id)?;
            let mut resource = resource.clone();
            let previous_cover = previous
                .as_ref()
                .and_then(|value| value.cover_asset_id.as_deref());
            if let Some(source_id) = resource.cover_asset_id.as_deref()
                && Some(source_id) != previous_cover
            {
                let source = read_asset_on(&transaction, source_id)?;
                if !matches!(&source.source, AssetSource::ResourceCover { resource_id } if resource_id == &resource.id)
                {
                    let asset = self.stage_resource_cover(&transaction, source_id, &resource.id)?;
                    staged.push(asset.id.clone());
                    insert_asset(&transaction, &asset)?;
                    resource.cover_asset_id = Some(asset.id);
                }
            }
            let saved = save_resource_on(&transaction, &resource)?;
            if let Some(id) = previous_cover
                && Some(id) != saved.cover_asset_id.as_deref()
                && remove_cover_on(&transaction, id, &resource.id)?
            {
                removed.push(id.to_owned());
            }
            transaction.commit().map_err(|error| {
                PersistenceError::failure("commit resource and cover save", error)
            })?;
            Ok(saved)
        })();
        if result.is_err() {
            self.clean_cover_files(&staged);
        } else {
            self.clean_cover_files(&removed);
        }
        result
    }

    /// Applies a complete selection atomically, including descendants and independent cover copies.
    /// # Errors
    /// Returns selection conflicts, invalid moves, unavailable covers or storage failures.
    pub fn batch_resources(
        &self,
        selection: &ResourceSelection,
        action: &ResourceBatchAction,
    ) -> Result<ResourceImpact, PersistenceError> {
        let mut staged = Vec::new();
        let mut removed = Vec::new();
        let result = (|| {
            let mut connection = self.database.connection()?;
            let transaction = connection
                .transaction()
                .map_err(|error| PersistenceError::failure("begin resource batch", error))?;
            let deleted = if matches!(action, ResourceBatchAction::Delete) {
                Some(impact_on(&transaction, selection)?)
            } else {
                None
            };
            let result = batch_on(
                &transaction,
                selection,
                action,
                |connection, original, new_id| {
                    let Some(id) = original.cover_asset_id.as_deref() else {
                        return Ok(None);
                    };
                    let asset = self.stage_resource_cover(connection, id, new_id)?;
                    staged.push(asset.id.clone());
                    insert_asset(connection, &asset)?;
                    Ok(Some(asset.id))
                },
            )?;
            if let Some(deleted) = deleted {
                for resource in deleted.resources {
                    if let Some(id) = resource.cover_asset_id
                        && remove_cover_on(&transaction, &id, &resource.id)?
                    {
                        removed.push(id);
                    }
                }
            }
            transaction
                .commit()
                .map_err(|error| PersistenceError::failure("commit resource batch", error))?;
            Ok(result)
        })();
        if result.is_err() {
            self.clean_cover_files(&staged);
        } else {
            self.clean_cover_files(&removed);
        }
        result
    }

    fn clean_cover_files(&self, ids: &[String]) {
        for id in ids {
            let path = match self.asset_path(id) {
                Ok(path) => path,
                Err(error) => {
                    tracing::warn!(asset_id=id,error=?error,"cannot resolve obsolete resource cover");
                    continue;
                },
            };
            for path in [
                path,
                self.directory.join("thumbnails").join(format!("{id}.png")),
            ] {
                if let Err(error) = std::fs::remove_file(&path)
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    tracing::warn!(asset_id=id,error=?error,"cannot remove obsolete resource cover file");
                }
            }
        }
    }
}

fn remove_cover_on(
    connection: &Connection,
    id: &str,
    resource_id: &str,
) -> Result<bool, PersistenceError> {
    let asset = read_asset_on(connection, id)?;
    if !matches!(asset.source,AssetSource::ResourceCover{resource_id:owner} if owner==resource_id) {
        return Err(crate::library::invalid(
            crate::api::UserMessage::ResourceCoverOwnership,
        ));
    }
    // JSON payloads retain immutable input identities outside relational foreign keys.
    // A released cover can already be a draft input, frozen job input or derived source.
    let referenced = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM resources r,json_tree(r.content) j WHERE j.type='text' AND j.value=?1) OR EXISTS(SELECT 1 FROM current_creation c,json_tree(json_array(json(c.composition),json(c.presets),json(c.characters),json(c.inputs),json(c.mask_editor),json(c.vibe_encoder),json(c.director),json(c.png_text_editor))) j WHERE j.type='text' AND j.value=?1) OR EXISTS(SELECT 1 FROM jobs job,json_tree(job.submission) j WHERE j.type='text' AND j.value=?1) OR EXISTS(SELECT 1 FROM media_assets asset,json_tree(asset.source) j WHERE asset.id<>?1 AND j.type='text' AND j.value=?1) OR EXISTS(SELECT 1 FROM generation_results WHERE asset_id=?1)",
        [id], |row| row.get::<_,bool>(0),
    ).map_err(|error|PersistenceError::failure("inspect released cover references",error))?;
    if referenced {
        connection
            .execute(
                "UPDATE media_assets SET source=?2 WHERE id=?1",
                rusqlite::params![
                    id,
                    crate::persistence::encode(&AssetSource::Import { name: None })?
                ],
            )
            .map_err(|error| PersistenceError::failure("retain a reused resource cover", error))?;
        return Ok(false);
    }
    connection
        .execute("DELETE FROM media_assets WHERE id=?1", [id])
        .map_err(|error| {
            PersistenceError::failure("remove obsolete resource cover metadata", error)
        })?;
    Ok(true)
}

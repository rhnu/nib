//! Resource ownership is separate from immutable content and historical provenance.
use std::{collections::HashSet, fs, path::Path};

use novelai_bridge::EncodedImage;
use rusqlite::Connection;

use super::{
    AssetKind, AssetSource, MediaAsset, MediaLibrary,
    content::AssetId,
    references::remove_owner_on,
    sqlite::{insert_asset, read_asset_on},
};
use crate::{
    library::{
        ResourceBatchAction, ResourceImpact, ResourceSaveMode, ResourceSelection,
        operations::batch_on,
    },
    persistence::PersistenceError,
    prompt::{Resource, sqlite::save_resource_on},
};

impl MediaLibrary {
    /// Imports a pending cover with its own logical identity and explicit resource owner.
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
        let mut asset = self.stage_asset(
            AssetKind::Image,
            super::assets::image_format(image.as_bytes()).mime_type(),
            image.as_bytes(),
            Some((image.size().width, image.size().height)),
            AssetSource::ResourceCover {
                resource_id: resource_id.to_owned(),
            },
        )?;
        asset.owner_resource_id = Some(resource_id.to_owned());
        self.database.insert_asset(&asset)?;
        Ok(asset)
    }

    /// Discards a pending cover, retaining any explicit media dependencies on it.
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
        release_cover_on(&transaction, asset_id, resource_id)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("discard pending cover", error))
    }

    /// Creates an independent asset identity while sharing the immutable cover content.
    /// # Errors
    /// Returns unavailable input images or a failure to retain an independent record.
    pub fn independent_input_id(&self, id: &str) -> Result<String, PersistenceError> {
        let mut connection = self.database.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin independent image copy", error))?;
        let mut asset = read_asset_on(&transaction, id)?;
        if asset.owner_resource_id.is_none() {
            return Ok(id.to_owned());
        }
        self.image_content(&asset)?;
        asset.id = AssetId::new().to_string();
        asset.owner_resource_id = None;
        asset.source = AssetSource::Import { name: None };
        asset.created_at = crate::jobs::timestamp()?;
        insert_asset(&transaction, &asset)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("retain independent image copy", error))?;
        Ok(asset.id)
    }

    fn stage_resource_cover(
        &self,
        connection: &Connection,
        id: &str,
        resource_id: &str,
    ) -> Result<MediaAsset, PersistenceError> {
        let mut asset = read_asset_on(connection, id)?;
        self.image_content(&asset)?;
        asset.id = AssetId::new().to_string();
        asset.created_at = crate::jobs::timestamp()?;
        asset.source = AssetSource::ResourceCover {
            resource_id: resource_id.into(),
        };
        asset.owner_resource_id = Some(resource_id.into());
        Ok(asset)
    }

    /// Saves metadata, owned cover and explicit media references in one transaction.
    /// # Errors
    /// Returns invalid metadata, missing resources, unavailable images or storage failures.
    pub fn save_resource_with_cover(
        &self,
        resource: &Resource,
        mode: ResourceSaveMode,
    ) -> Result<Resource, PersistenceError> {
        let mut connection = self.database.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin resource and cover save", error))?;
        let mut resource = resource.clone();
        if let Some(source_id) = resource.cover_asset_id.as_deref() {
            let source = read_asset_on(&transaction, source_id)?;
            if source.owner_resource_id.as_deref() != Some(resource.id.as_str()) {
                let asset = self.stage_resource_cover(&transaction, source_id, &resource.id)?;
                insert_asset(&transaction, &asset)?;
                resource.cover_asset_id = Some(asset.id);
            }
        }
        let saved = save_resource_on(&transaction, &resource, mode)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit resource and cover save", error))?;
        Ok(saved)
    }

    /// Applies a complete selection atomically, including independent cover records.
    /// # Errors
    /// Returns missing selections, invalid moves, unavailable covers or storage failures.
    pub fn batch_resources(
        &self,
        selection: &ResourceSelection,
        action: &ResourceBatchAction,
    ) -> Result<ResourceImpact, PersistenceError> {
        let mut connection = self.database.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin resource batch", error))?;
        let result = batch_on(
            &transaction,
            selection,
            action,
            |connection, original, new_id| {
                let Some(id) = original.cover_asset_id.as_deref() else {
                    return Ok(None);
                };
                let asset = self.stage_resource_cover(connection, id, new_id)?;
                insert_asset(connection, &asset)?;
                Ok(Some(asset.id))
            },
        )?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit resource batch", error))?;
        Ok(result)
    }

    /// Reclaims interrupted writes only during initialization, before this library is shared.
    /// The host holds the data directory exclusively and no executor or importer is running.
    pub(super) fn recover_orphans(&self) -> Result<(), PersistenceError> {
        let mut connection = self.database.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin media recovery", error))?;
        let pending = {
            let mut statement = transaction.prepare("SELECT id,owner_resource_id FROM media_assets a WHERE owner_resource_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM resources r WHERE r.id=a.owner_resource_id AND r.cover_asset_id=a.id)").map_err(|error| PersistenceError::failure("prepare abandoned cover recovery", error))?;
            statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| PersistenceError::failure("read abandoned covers", error))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| PersistenceError::failure("decode abandoned covers", error))?
        };
        for (id, owner) in &pending {
            release_cover_on(&transaction, id, owner)?;
        }
        transaction.execute("DELETE FROM media_blobs WHERE NOT EXISTS(SELECT 1 FROM media_assets WHERE blob_id=media_blobs.id)", []).map_err(|error| PersistenceError::failure("remove unused media blob records", error))?;
        let retained: HashSet<String> = {
            let mut statement =
                transaction
                    .prepare("SELECT id FROM media_blobs")
                    .map_err(|error| {
                        PersistenceError::failure("prepare retained media blobs", error)
                    })?;
            statement
                .query_map([], |row| row.get(0))
                .map_err(|error| PersistenceError::failure("read retained media blobs", error))?
                .collect::<Result<_, _>>()
                .map_err(|error| PersistenceError::failure("decode retained media blobs", error))?
        };
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit media recovery", error))?;
        // Runtime deletion leaves files intact: an importer may have staged the same content
        // before committing its asset. Initialization is the exclusive cleanup point.
        clean_directory(&self.directory.join("objects"), |name| {
            retained.contains(name)
        })?;
        clean_directory(&self.directory.join("staging"), |_| false)?;
        clean_directory(&self.directory.join("thumbnails"), |name| {
            name.strip_suffix("-256-v1.png")
                .or_else(|| name.strip_suffix("-256-v1.png.sha256"))
                .is_some_and(|id| retained.contains(id))
        })?;
        tracing::debug!(
            released_covers = pending.len(),
            retained_blobs = retained.len(),
            "recovered media storage"
        );
        Ok(())
    }
}

/// Releases ownership without rewriting provenance; dependents decide asset retention.
pub(crate) fn release_cover_on(
    connection: &Connection,
    id: &str,
    resource_id: &str,
) -> Result<(), PersistenceError> {
    let asset = read_asset_on(connection, id)?;
    if asset.owner_resource_id.as_deref() != Some(resource_id) {
        return Err(crate::library::invalid(
            crate::api::UserMessage::ResourceCoverOwnership,
        ));
    }
    let referenced: bool = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM media_references WHERE asset_id=?1)",
            [id],
            |row| row.get(0),
        )
        .map_err(|error| PersistenceError::failure("inspect released cover references", error))?;
    if referenced {
        connection
            .execute(
                "UPDATE media_assets SET owner_resource_id=NULL WHERE id=?1",
                [id],
            )
            .map_err(|error| PersistenceError::failure("release a reused resource cover", error))?;
    } else {
        remove_owner_on(connection, "asset", id)?;
        connection
            .execute("DELETE FROM media_assets WHERE id=?1", [id])
            .map_err(|error| {
                PersistenceError::failure("remove obsolete resource cover metadata", error)
            })?;
    }
    Ok(())
}

fn clean_directory(directory: &Path, keep: impl Fn(&str) -> bool) -> Result<(), PersistenceError> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(PersistenceError::failure(
                "inspect media recovery directory",
                error,
            ));
        },
    };
    for entry in entries {
        let entry = entry
            .map_err(|error| PersistenceError::failure("inspect recoverable media file", error))?;
        let name = entry.file_name();
        let kind = entry.file_type().map_err(|error| {
            PersistenceError::failure("inspect recoverable media file type", error)
        })?;
        if kind.is_file() && !name.to_str().is_some_and(&keep) {
            fs::remove_file(entry.path())
                .map_err(|error| PersistenceError::failure("remove orphaned media file", error))?;
        }
    }
    Ok(())
}

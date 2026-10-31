use std::{cell::RefCell, collections::HashMap};

use rusqlite::{Connection, OptionalExtension as _, params};

use super::{Resource, ResourceReader, ResourceWriter, validate_resource};
use crate::{
    library::ResourceSaveMode,
    persistence::{PersistenceError, SqliteDatabase, encode},
};

type ResourceCache = RefCell<HashMap<String, Option<Resource>>>;

/// Consistent resource reads and their decoded values live only for this transaction.
pub struct ResourceSnapshot<'a> {
    connection: &'a Connection,
    resources: ResourceCache,
}

impl<'a> ResourceSnapshot<'a> {
    pub(crate) fn new(connection: &'a Connection) -> Self {
        Self {
            connection,
            resources: RefCell::default(),
        }
    }
}

fn cached_resource(
    cache: &ResourceCache,
    id: &str,
    load: impl FnOnce() -> Result<Option<Resource>, PersistenceError>,
) -> Result<Option<Resource>, PersistenceError> {
    if let Some(value) = cache.borrow().get(id) {
        return Ok(value.clone());
    }
    // Failed reads retain their error; only a known value or known absence is reusable.
    let value = load()?;
    cache.borrow_mut().insert(id.to_owned(), value.clone());
    Ok(value)
}

pub(crate) fn get_resource(
    connection: &Connection,
    id: &str,
) -> Result<Option<Resource>, PersistenceError> {
    crate::library::validate_id(id)?;
    let row = connection.query_row(
        "SELECT id, name, content, description, folder_id, cover_asset_id, created_at, updated_at FROM resources WHERE id = ?1",
        [id], |row| Ok(Resource {
            id: row.get(0)?, name: row.get(1)?,
            content: serde_json::from_str(&row.get::<_, String>(2)?).map_err(|error| rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error)))?,
            description: row.get(3)?, folder_id: row.get(4)?, cover_asset_id: row.get(5)?,
            created_at: row.get(6)?, updated_at: row.get(7)?,
            aliases: Vec::new(), tags: Vec::new(), models: Vec::new(),
        }),
    ).optional().map_err(|error| PersistenceError::failure("read a resource", error))?;
    row.map(|mut resource| {
        resource.aliases = relation_values(connection, "resource_aliases", id)?;
        resource.tags = relation_values(connection, "resource_tags", id)?;
        resource.models = relation_values(connection, "resource_models", id)?;
        Ok(resource)
    })
    .transpose()
}

fn relation_values(
    connection: &Connection,
    table: &str,
    id: &str,
) -> Result<Vec<String>, PersistenceError> {
    let mut statement = connection
        .prepare(&format!(
            "SELECT value FROM {table} WHERE resource_id = ?1 ORDER BY value COLLATE NOCASE"
        ))
        .map_err(|error| PersistenceError::failure("prepare resource metadata", error))?;
    statement
        .query_map([id], |row| row.get(0))
        .map_err(|error| PersistenceError::failure("read resource metadata", error))?
        .collect::<Result<_, _>>()
        .map_err(|error| PersistenceError::failure("decode resource metadata", error))
}

pub(crate) fn save_resource_on(
    connection: &Connection,
    resource: &Resource,
    mode: ResourceSaveMode,
) -> Result<Resource, PersistenceError> {
    validate_resource(resource).map_err(|error| PersistenceError::InvalidData {
        message: crate::api::UserMessage::Validation {
            field: error.field,
            message: Box::new(error.message),
        },
    })?;
    crate::library::operations::require_folder(connection, resource.folder_id.as_deref())?;
    let previous = get_resource(connection, &resource.id)?;
    match (mode, previous.is_some()) {
        (ResourceSaveMode::Create, true) => {
            return Err(PersistenceError::Conflict {
                kind: "resource",
                id: resource.id.clone(),
            });
        },
        (ResourceSaveMode::Update, false) => {
            return Err(PersistenceError::NotFound {
                kind: "resource",
                id: resource.id.clone(),
            });
        },
        _ => {},
    }
    let previous_cover = previous.and_then(|previous| previous.cover_asset_id);
    if let Some(id) = &resource.cover_asset_id {
        let owner: Option<Option<String>> = connection
            .query_row(
                "SELECT owner_resource_id FROM media_assets WHERE id = ?1 AND kind = 'image'",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| PersistenceError::failure("read resource cover", error))?;
        if owner.flatten().as_deref() != Some(resource.id.as_str()) {
            return Err(crate::library::invalid(
                crate::api::UserMessage::ResourceCoverOwnership,
            ));
        }
    }
    let now = crate::jobs::timestamp()?;
    let content = encode(&resource.content)?;
    match mode {
        ResourceSaveMode::Create => connection.execute(
            "INSERT INTO resources(id,name,content,description,folder_id,cover_asset_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
            params![resource.id,resource.name.trim(),content,resource.description,resource.folder_id,resource.cover_asset_id,now]),
        ResourceSaveMode::Update => connection.execute(
            "UPDATE resources SET name=?2,content=?3,description=?4,folder_id=?5,cover_asset_id=?6,updated_at=?7 WHERE id=?1",
            params![resource.id,resource.name.trim(),content,resource.description,resource.folder_id,resource.cover_asset_id,now]),
    }.map_err(|error| PersistenceError::failure("save a resource", error))?;
    for (table, values) in [
        ("resource_aliases", &resource.aliases),
        ("resource_tags", &resource.tags),
        ("resource_models", &resource.models),
    ] {
        connection
            .execute(
                &format!("DELETE FROM {table} WHERE resource_id=?1"),
                [&resource.id],
            )
            .map_err(|error| PersistenceError::failure("replace resource metadata", error))?;
        for value in values {
            connection
                .execute(
                    &format!("INSERT INTO {table}(resource_id,value) VALUES (?1,?2)"),
                    params![resource.id, value],
                )
                .map_err(|error| PersistenceError::failure("save resource metadata", error))?;
        }
    }
    crate::media::references::sync_resource_on(connection, resource)?;
    if let Some(id) = previous_cover.as_deref()
        && Some(id) != resource.cover_asset_id.as_deref()
    {
        crate::media::resource_covers::release_cover_on(connection, id, &resource.id)?;
    }
    get_resource(connection, &resource.id)?.ok_or_else(|| PersistenceError::NotFound {
        kind: "resource",
        id: resource.id.clone(),
    })
}

impl ResourceReader for SqliteDatabase {
    fn get_resource(&self, id: &str) -> Result<Option<Resource>, PersistenceError> {
        let connection = self.connection()?;
        get_resource(&connection, id)
    }
}

impl ResourceReader for ResourceSnapshot<'_> {
    fn get_resource(&self, id: &str) -> Result<Option<Resource>, PersistenceError> {
        cached_resource(&self.resources, id, || get_resource(self.connection, id))
    }
}

impl ResourceWriter for SqliteDatabase {
    fn save_resource(
        &self,
        resource: &Resource,
        mode: ResourceSaveMode,
    ) -> Result<Resource, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin saving a resource", error))?;
        let saved = save_resource_on(&transaction, resource, mode)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit a resource", error))?;
        Ok(saved)
    }

    fn delete_resource(&self, id: &str) -> Result<(), PersistenceError> {
        crate::library::validate_id(id)?;
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin deleting a resource", error))?;
        let previous = get_resource(&transaction, id)?;
        let count = transaction
            .execute("DELETE FROM resources WHERE id=?1", [id])
            .map_err(|error| PersistenceError::failure("delete a resource", error))?;
        if count == 0 {
            return Err(PersistenceError::NotFound {
                kind: "resource",
                id: id.to_owned(),
            });
        }
        crate::media::references::remove_owner_on(&transaction, "resource", id)?;
        if let Some(cover) = previous.and_then(|resource| resource.cover_asset_id) {
            crate::media::resource_covers::release_cover_on(&transaction, &cover, id)?;
        }
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit resource deletion", error))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;

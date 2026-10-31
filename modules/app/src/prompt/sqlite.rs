use std::{cell::RefCell, collections::HashMap};

use rusqlite::{Connection, OptionalExtension as _, params};

use super::{Resource, ResourceReader, ResourceWriter, validate_resource};
use crate::persistence::{
    PersistenceError, SqliteDatabase, decode, encode, next_revision, write_miss,
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
        "SELECT id, revision, name, content, description, folder_id, cover_asset_id, created_at, updated_at FROM resources WHERE id = ?1",
        [id], |row| Ok(Resource {
            id: row.get(0)?, revision: row.get(1)?, name: row.get(2)?,
            content: serde_json::from_str(&row.get::<_, String>(3)?).map_err(|error| rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(error)))?,
            description: row.get(4)?, folder_id: row.get(5)?, cover_asset_id: row.get(6)?,
            created_at: row.get(7)?, updated_at: row.get(8)?,
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
) -> Result<Resource, PersistenceError> {
    validate_resource(resource).map_err(|error| PersistenceError::InvalidData {
        message: crate::api::UserMessage::Validation {
            field: error.field,
            message: Box::new(error.message),
        },
    })?;
    crate::library::operations::require_folder(connection, resource.folder_id.as_deref())?;
    if let Some(id) = &resource.cover_asset_id {
        let source: Option<String> = connection
            .query_row(
                "SELECT source FROM media_assets WHERE id = ?1 AND kind = 'image'",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| PersistenceError::failure("read resource cover", error))?;
        let owned = source
            .map(|source| decode::<crate::media::AssetSource>(&source))
            .transpose()?;
        if !matches!(owned, Some(crate::media::AssetSource::ResourceCover { resource_id }) if resource_id == resource.id)
        {
            return Err(crate::library::invalid(
                crate::api::UserMessage::ResourceCoverOwnership,
            ));
        }
    }
    let revision = next_revision(resource.revision)?;
    let now = crate::jobs::timestamp()?;
    let content = encode(&resource.content)?;
    let count = if resource.revision == 0 {
        connection.execute("INSERT INTO resources(id,revision,name,content,description,folder_id,cover_asset_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8) ON CONFLICT(id) DO NOTHING",
            params![resource.id,revision,resource.name.trim(),content,resource.description,resource.folder_id,resource.cover_asset_id,now])
    } else {
        connection.execute("UPDATE resources SET revision=?2,name=?3,content=?4,description=?5,folder_id=?6,cover_asset_id=?7,updated_at=?8 WHERE id=?1 AND revision=?9",
            params![resource.id,revision,resource.name.trim(),content,resource.description,resource.folder_id,resource.cover_asset_id,now,resource.revision])
    }.map_err(|error| PersistenceError::failure("save a resource", error))?;
    if count == 0 {
        return Err(write_miss(
            connection,
            "resources",
            "resource",
            &resource.id,
        ));
    }
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
    fn save_resource(&self, resource: &Resource) -> Result<Resource, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin saving a resource", error))?;
        let saved = save_resource_on(&transaction, resource)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit a resource", error))?;
        Ok(saved)
    }

    fn delete_resource(&self, id: &str, revision: u32) -> Result<(), PersistenceError> {
        crate::library::validate_id(id)?;
        let connection = self.connection()?;
        let count = connection
            .execute(
                "DELETE FROM resources WHERE id=?1 AND revision=?2",
                params![id, revision],
            )
            .map_err(|error| PersistenceError::failure("delete a resource", error))?;
        if count == 0 {
            return Err(write_miss(&connection, "resources", "resource", id));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;

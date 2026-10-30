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

fn get_resource(connection: &Connection, id: &str) -> Result<Option<Resource>, PersistenceError> {
    let row = connection
        .query_row(
            "SELECT id, revision, name, content FROM resources WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, u32>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| PersistenceError::failure("read a resource", error))?;
    row.map(|(id, revision, name, content)| {
        Ok(Resource {
            id,
            revision,
            name,
            content: decode(&content)?,
        })
    })
    .transpose()
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
        validate_resource(resource).map_err(|error| PersistenceError::InvalidData {
            message: crate::api::UserMessage::Validation {
                field: error.field,
                message: Box::new(error.message),
            },
        })?;
        let revision = next_revision(resource.revision)?;
        let content = encode(&resource.content)?;
        let connection = self.connection()?;
        let count = if resource.revision == 0 {
            connection.execute(
                "INSERT INTO resources(id, revision, name, content) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO NOTHING",
                params![resource.id, revision, resource.name, content],
            )
        } else {
            connection.execute(
                "UPDATE resources SET revision = ?2, name = ?3, content = ?4 WHERE id = ?1 AND revision = ?5",
                params![resource.id, revision, resource.name, content, resource.revision],
            )
        }.map_err(|error| PersistenceError::failure("save a resource", error))?;
        if count == 0 {
            return Err(write_miss(
                &connection,
                "resources",
                "resource",
                &resource.id,
            ));
        }
        Ok(Resource {
            revision,
            ..resource.clone()
        })
    }

    fn delete_resource(&self, id: &str, revision: u32) -> Result<(), PersistenceError> {
        let connection = self.connection()?;
        let count = connection
            .execute(
                "DELETE FROM resources WHERE id = ?1 AND revision = ?2",
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

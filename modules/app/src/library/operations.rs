//! Folder topology and shared tag edits.
mod batch;
mod impact;
use std::collections::HashSet;

pub(crate) use batch::batch_on;
#[cfg(test)]
use impact::contains_reference;
pub(crate) use impact::impact_on;
use rusqlite::{Connection, params};

use super::{
    ResourceFolder, ResourceImpact, ResourceSelection, invalid,
    sqlite::{all_resources, summary},
    validate_id,
};
use crate::{
    persistence::{PersistenceError, SqliteDatabase, next_revision, write_miss},
    prompt::sqlite::save_resource_on,
};

pub(crate) fn folders_on(connection: &Connection) -> Result<Vec<ResourceFolder>, PersistenceError> {
    let mut statement = connection.prepare("SELECT id,revision,name,parent_id,created_at,updated_at FROM resource_folders ORDER BY name COLLATE NOCASE,id")
        .map_err(|error|PersistenceError::failure("prepare resource folders",error))?;
    statement
        .query_map([], |row| {
            Ok(ResourceFolder {
                id: row.get(0)?,
                revision: row.get(1)?,
                name: row.get(2)?,
                parent_id: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|error| PersistenceError::failure("read resource folders", error))?
        .collect::<Result<_, _>>()
        .map_err(|error| PersistenceError::failure("decode resource folders", error))
}

pub(crate) fn require_folder(
    connection: &Connection,
    id: Option<&str>,
) -> Result<(), PersistenceError> {
    if let Some(id) = id {
        validate_id(id)?;
        let exists = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM resource_folders WHERE id=?1)",
                [id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| PersistenceError::failure("read destination folder", error))?;
        if !exists {
            return Err(PersistenceError::NotFound {
                kind: "resource folder",
                id: id.into(),
            });
        }
    }
    Ok(())
}

pub(crate) fn validate_parent(
    id: &str,
    parent: Option<&str>,
    folders: &[ResourceFolder],
) -> Result<(), PersistenceError> {
    let mut current = parent;
    let mut seen = HashSet::new();
    while let Some(ancestor) = current {
        if ancestor == id || !seen.insert(ancestor) {
            return Err(invalid(crate::api::UserMessage::ResourceFolderCycle));
        }
        current = folders
            .iter()
            .find(|folder| folder.id == ancestor)
            .and_then(|folder| folder.parent_id.as_deref());
    }
    Ok(())
}

pub(crate) fn save_folder_on(
    connection: &Connection,
    folder: &ResourceFolder,
) -> Result<ResourceFolder, PersistenceError> {
    validate_id(&folder.id)?;
    let name = folder.name.trim();
    if name.is_empty() {
        return Err(invalid(crate::api::UserMessage::ResourceFolderNameRequired));
    }
    require_folder(connection, folder.parent_id.as_deref())?;
    let folders = folders_on(connection)?;
    validate_parent(&folder.id, folder.parent_id.as_deref(), &folders)?;
    if folders.iter().any(|other| {
        other.id != folder.id
            && other.parent_id == folder.parent_id
            && other.name.to_lowercase() == name.to_lowercase()
    }) {
        return Err(invalid(crate::api::UserMessage::ResourceFolderNameConflict));
    }
    let now = crate::jobs::timestamp()?;
    let revision = next_revision(folder.revision)?;
    let count=if folder.revision==0 {
        connection.execute("INSERT INTO resource_folders(id,revision,name,parent_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?5) ON CONFLICT(id) DO NOTHING",params![folder.id,revision,name,folder.parent_id,now])
    } else {
        connection.execute("UPDATE resource_folders SET revision=?2,name=?3,parent_id=?4,updated_at=?5 WHERE id=?1 AND revision=?6",params![folder.id,revision,name,folder.parent_id,now,folder.revision])
    }.map_err(|error|PersistenceError::failure("save resource folder",error))?;
    if count == 0 {
        return Err(write_miss(
            connection,
            "resource_folders",
            "resource folder",
            &folder.id,
        ));
    }
    folders_on(connection)?
        .into_iter()
        .find(|value| value.id == folder.id)
        .ok_or_else(|| PersistenceError::NotFound {
            kind: "resource folder",
            id: folder.id.clone(),
        })
}

impl SqliteDatabase {
    /// Lists the resource folder tree.
    /// # Errors
    /// Returns database query or decoding failures.
    pub fn list_resource_folders(&self) -> Result<Vec<ResourceFolder>, PersistenceError> {
        let connection = self.connection()?;
        folders_on(&connection)
    }

    /// Saves a folder using its expected revision.
    /// # Errors
    /// Returns invalid topology, duplicate sibling names, revision conflicts or storage failures.
    pub fn save_resource_folder(
        &self,
        folder: &ResourceFolder,
    ) -> Result<ResourceFolder, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin folder edit", error))?;
        let saved = save_folder_on(&transaction, folder)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit folder edit", error))?;
        Ok(saved)
    }

    /// Lists the shared tags used by resources.
    /// # Errors
    /// Returns database query or decoding failures.
    pub fn list_resource_tags(&self) -> Result<Vec<String>, PersistenceError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare("SELECT DISTINCT value FROM resource_tags ORDER BY value COLLATE NOCASE")
            .map_err(|error| PersistenceError::failure("prepare resource tags", error))?;
        statement
            .query_map([], |row| row.get(0))
            .map_err(|error| PersistenceError::failure("query resource tags", error))?
            .collect::<Result<_, _>>()
            .map_err(|error| PersistenceError::failure("read resource tags", error))
    }

    /// Reports selected descendants and current resource consumers.
    /// # Errors
    /// Returns missing selections, stale revisions or storage failures.
    pub fn resource_selection_impact(
        &self,
        selection: &ResourceSelection,
    ) -> Result<ResourceImpact, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin resource impact query", error))?;
        let impact = impact_on(&transaction, selection)?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("finish resource impact query", error))?;
        Ok(impact)
    }
}

#[cfg(test)]
mod tests;

impl SqliteDatabase {
    /// Renames one shared tag across every associated resource, including case-only edits.
    /// # Errors
    /// Returns an unknown tag, invalid new name or transaction failure.
    pub fn rename_resource_tag(
        &self,
        old_name: &str,
        new_name: &str,
    ) -> Result<Vec<super::ResourceSummary>, PersistenceError> {
        let name = new_name.trim();
        if name.is_empty() {
            return Err(invalid(crate::api::UserMessage::InvalidResourceMetadata));
        }
        self.change_resource_tag(old_name, Some(name))
    }

    /// Removes a shared tag and its associations while retaining all resource content.
    /// # Errors
    /// Returns an unknown tag or transaction failure.
    pub fn delete_resource_tag(
        &self,
        name: &str,
    ) -> Result<Vec<super::ResourceSummary>, PersistenceError> {
        self.change_resource_tag(name, None)
    }

    fn change_resource_tag(
        &self,
        name: &str,
        replacement: Option<&str>,
    ) -> Result<Vec<super::ResourceSummary>, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin shared tag edit", error))?;
        let affected: Vec<_> = all_resources(&transaction)?
            .into_iter()
            .filter(|resource| {
                resource
                    .tags
                    .iter()
                    .any(|tag| tag.to_lowercase() == name.to_lowercase())
            })
            .collect();
        if affected.is_empty() {
            return Err(PersistenceError::NotFound {
                kind: "resource tag",
                id: name.into(),
            });
        }
        let mut changed = Vec::new();
        for mut resource in affected {
            resource.tags.retain(|tag| {
                tag.to_lowercase() != name.to_lowercase()
                    && replacement
                        .is_none_or(|new_name| tag.to_lowercase() != new_name.to_lowercase())
            });
            if let Some(replacement) = replacement {
                resource.tags.push(replacement.into());
            }
            changed.push(summary(&save_resource_on(&transaction, &resource)?));
        }
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit shared tag edit", error))?;
        Ok(changed)
    }
}

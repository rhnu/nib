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
    ResourceFolder, ResourceFolderChange, ResourceFolderEdit, ResourceImpact, ResourceSaveMode,
    ResourceSelection, invalid,
    sqlite::{all_resources, summary},
    validate_id,
};
use crate::{
    persistence::{PersistenceError, SqliteDatabase},
    prompt::sqlite::save_resource_on,
};

pub(crate) fn folders_on(connection: &Connection) -> Result<Vec<ResourceFolder>, PersistenceError> {
    let mut statement = connection.prepare("SELECT id,name,parent_id,created_at,updated_at FROM resource_folders ORDER BY name COLLATE NOCASE,id")
        .map_err(|error|PersistenceError::failure("prepare resource folders",error))?;
    statement
        .query_map([], |row| {
            Ok(ResourceFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
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

/// Applies only the caller's explicit changes to the latest stored folder.
fn apply_folder_changes(folder: &mut ResourceFolder, changes: &[ResourceFolderChange]) {
    for change in changes {
        match change {
            ResourceFolderChange::Name { name } => folder.name.clone_from(name),
            ResourceFolderChange::Parent { parent_id } => folder.parent_id.clone_from(parent_id),
        }
    }
}

/// Checks the proposed folder against the current tree without performing database I/O.
fn validate_folder_relationships(
    folder: &ResourceFolder,
    folders: &[ResourceFolder],
) -> Result<(), PersistenceError> {
    let name = folder.name.trim();
    if name.is_empty() {
        return Err(invalid(crate::api::UserMessage::ResourceFolderNameRequired));
    }
    if let Some(parent) = folder.parent_id.as_deref() {
        validate_id(parent)?;
        if !folders.iter().any(|candidate| candidate.id == parent) {
            return Err(PersistenceError::NotFound {
                kind: "resource folder",
                id: parent.to_owned(),
            });
        }
    }
    validate_parent(&folder.id, folder.parent_id.as_deref(), folders)?;
    if folders.iter().any(|other| {
        other.id != folder.id
            && other.parent_id == folder.parent_id
            && other.name.to_lowercase() == name.to_lowercase()
    }) {
        return Err(invalid(crate::api::UserMessage::ResourceFolderNameConflict));
    }
    Ok(())
}

pub(crate) fn save_folder_on(
    connection: &Connection,
    folder: &ResourceFolder,
    mode: ResourceSaveMode,
) -> Result<ResourceFolder, PersistenceError> {
    validate_id(&folder.id)?;
    let folders = folders_on(connection)?;
    let exists = folders.iter().any(|existing| existing.id == folder.id);
    match (mode, exists) {
        (ResourceSaveMode::Create, true) => {
            return Err(PersistenceError::Conflict {
                kind: "resource folder",
                id: folder.id.clone(),
            });
        },
        (ResourceSaveMode::Update, false) => {
            return Err(PersistenceError::NotFound {
                kind: "resource folder",
                id: folder.id.clone(),
            });
        },
        _ => {},
    }
    validate_folder_relationships(folder, &folders)?;
    let now = crate::jobs::timestamp()?;
    match mode {
        ResourceSaveMode::Create => connection.execute(
            "INSERT INTO resource_folders(id,name,parent_id,created_at,updated_at) VALUES (?1,?2,?3,?4,?4)",
            params![folder.id,folder.name.trim(),folder.parent_id,now]),
        ResourceSaveMode::Update => connection.execute(
            "UPDATE resource_folders SET name=?2,parent_id=?3,updated_at=?4 WHERE id=?1",
            params![folder.id,folder.name.trim(),folder.parent_id,now]),
    }.map_err(|error| PersistenceError::failure("save resource folder",error))?;
    folders_on(connection)?
        .into_iter()
        .find(|value| value.id == folder.id)
        .ok_or_else(|| PersistenceError::NotFound {
            kind: "resource folder",
            id: folder.id.clone(),
        })
}

fn edit_folder_on(
    connection: &Connection,
    edit: &ResourceFolderEdit,
) -> Result<ResourceFolder, PersistenceError> {
    match edit {
        ResourceFolderEdit::Create {
            id,
            name,
            parent_id,
        } => save_folder_on(
            connection,
            &ResourceFolder {
                id: id.clone(),
                name: name.clone(),
                parent_id: parent_id.clone(),
                created_at: 0,
                updated_at: 0,
            },
            ResourceSaveMode::Create,
        ),
        ResourceFolderEdit::Update { id, changes } => {
            validate_id(id)?;
            let mut folder = folders_on(connection)?
                .into_iter()
                .find(|folder| folder.id == *id)
                .ok_or_else(|| PersistenceError::NotFound {
                    kind: "resource folder",
                    id: id.clone(),
                })?;
            if changes.is_empty() {
                return Ok(folder);
            }
            apply_folder_changes(&mut folder, changes);
            save_folder_on(connection, &folder, ResourceSaveMode::Update)
        },
    }
}

impl SqliteDatabase {
    /// Lists the resource folder tree.
    /// # Errors
    /// Returns database query or decoding failures.
    pub fn list_resource_folders(&self) -> Result<Vec<ResourceFolder>, PersistenceError> {
        let connection = self.connection()?;
        folders_on(&connection)
    }

    /// Creates a folder or applies explicit changes to its latest stored fields.
    /// # Errors
    /// Returns invalid topology, duplicate identities or sibling names, missing folders or storage failures.
    pub fn save_resource_folder(
        &self,
        edit: &ResourceFolderEdit,
    ) -> Result<ResourceFolder, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin folder edit", error))?;
        let saved = edit_folder_on(&transaction, edit)?;
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
    /// Returns missing selections or storage failures.
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
            changed.push(summary(&save_resource_on(
                &transaction,
                &resource,
                ResourceSaveMode::Update,
            )?));
        }
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit shared tag edit", error))?;
        Ok(changed)
    }
}

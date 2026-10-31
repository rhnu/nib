//! Transactional tree selection moves, copies and deletions.
use std::collections::{HashMap, HashSet};

use rusqlite::Connection;

use super::{folders_on, impact_on, require_folder, save_folder_on};
use crate::{
    library::{ResourceBatchAction, ResourceImpact, ResourceSelection, invalid, sqlite::summary},
    persistence::PersistenceError,
    prompt::{
        Resource,
        sqlite::{get_resource, save_resource_on},
    },
};

/// Executes against one write transaction. Cover copies are staged through the media owner.
pub(crate) fn batch_on(
    connection: &Connection,
    selection: &ResourceSelection,
    action: &ResourceBatchAction,
    mut copy_cover: impl FnMut(&Connection, &Resource, &str) -> Result<Option<String>, PersistenceError>,
) -> Result<ResourceImpact, PersistenceError> {
    let impact = impact_on(connection, selection)?;
    let roots: HashSet<_> = impact
        .folders
        .iter()
        .filter(|folder| {
            !folder.parent_id.as_ref().is_some_and(|parent| {
                impact
                    .folders
                    .iter()
                    .any(|candidate| &candidate.id == parent)
            })
        })
        .map(|folder| folder.id.clone())
        .collect();
    match action {
        ResourceBatchAction::Move { folder_id } | ResourceBatchAction::Copy { folder_id } => {
            require_folder(connection, folder_id.as_deref())?;
            if folder_id
                .as_ref()
                .is_some_and(|id| impact.folders.iter().any(|folder| &folder.id == id))
            {
                return Err(invalid(crate::api::UserMessage::ResourceFolderCycle));
            }
        },
        _ => {},
    }
    let mut result = ResourceImpact {
        resources: Vec::new(),
        folders: Vec::new(),
        referencing_resources: impact.referencing_resources.clone(),
        current_creation: impact.current_creation,
    };
    match action {
        ResourceBatchAction::Delete => {
            delete_selection(connection, &impact)?;
            return Ok(impact);
        },
        ResourceBatchAction::Move { folder_id } => {
            move_selection(
                connection,
                &impact,
                &roots,
                folder_id.as_deref(),
                &mut result,
            )?;
        },
        ResourceBatchAction::Metadata { tags, models } => {
            for resource in &impact.resources {
                let mut resource = get_resource(connection, &resource.id)?.ok_or_else(|| {
                    PersistenceError::NotFound {
                        kind: "resource",
                        id: resource.id.clone(),
                    }
                })?;
                if let Some(tags) = tags {
                    resource.tags.clone_from(tags);
                }
                if let Some(models) = models {
                    resource.models.clone_from(models);
                }
                result
                    .resources
                    .push(summary(&save_resource_on(connection, &resource)?));
            }
        },
        ResourceBatchAction::Copy { folder_id } => {
            copy_selection(
                connection,
                &impact,
                &roots,
                folder_id.as_deref(),
                &mut result,
                &mut copy_cover,
            )?;
        },
    }
    Ok(result)
}

fn remap_content(content: &mut crate::prompt::ResourceContent, mapping: &HashMap<String, String>) {
    if let crate::prompt::ResourceContent::Preset {
        composition,
        characters,
        ..
    } = content
    {
        for composition in std::iter::once(composition).chain(
            characters
                .iter_mut()
                .map(|character| &mut character.composition),
        ) {
            for node in composition
                .positive
                .iter_mut()
                .chain(&mut composition.negative)
            {
                if let crate::prompt::PromptNode::Chunk { resource_id, .. } = node
                    && let Some(id) = mapping.get(resource_id)
                {
                    resource_id.clone_from(id);
                }
            }
        }
    }
}

fn delete_selection(
    connection: &Connection,
    impact: &ResourceImpact,
) -> Result<(), PersistenceError> {
    for resource in &impact.resources {
        connection
            .execute("DELETE FROM resources WHERE id=?1", [&resource.id])
            .map_err(|error| PersistenceError::failure("delete selected resource", error))?;
        crate::media::references::remove_owner_on(connection, "resource", &resource.id)?;
    }
    for resource in &impact.resources {
        if let Some(id) = &resource.cover_asset_id {
            crate::media::resource_covers::release_cover_on(connection, id, &resource.id)?;
        }
    }
    let mut remaining = impact.folders.clone();
    while !remaining.is_empty() {
        let leaves: Vec<_> = remaining
            .iter()
            .filter(|folder| {
                !remaining
                    .iter()
                    .any(|child| child.parent_id.as_deref() == Some(&folder.id))
            })
            .map(|folder| folder.id.clone())
            .collect();
        if leaves.is_empty() {
            return Err(invalid(crate::api::UserMessage::ResourceFolderCycle));
        }
        for id in &leaves {
            connection
                .execute("DELETE FROM resource_folders WHERE id=?1", [id])
                .map_err(|error| PersistenceError::failure("delete selected folder", error))?;
        }
        remaining.retain(|folder| !leaves.contains(&folder.id));
    }

    Ok(())
}

fn move_selection(
    connection: &Connection,
    impact: &ResourceImpact,
    roots: &HashSet<String>,
    folder_id: Option<&str>,
    result: &mut ResourceImpact,
) -> Result<(), PersistenceError> {
    for folder in impact
        .folders
        .iter()
        .filter(|folder| roots.contains(&folder.id))
    {
        let mut folder = folder.clone();
        folder.parent_id = folder_id.map(str::to_owned);
        result.folders.push(save_folder_on(connection, &folder)?);
    }
    for resource in &impact.resources {
        if resource.folder_id.as_ref().is_some_and(|folder| {
            impact
                .folders
                .iter()
                .any(|candidate| &candidate.id == folder)
        }) {
            continue;
        }
        let mut resource =
            get_resource(connection, &resource.id)?.ok_or_else(|| PersistenceError::NotFound {
                kind: "resource",
                id: resource.id.clone(),
            })?;
        resource.folder_id = folder_id.map(str::to_owned);
        result
            .resources
            .push(summary(&save_resource_on(connection, &resource)?));
    }

    Ok(())
}

fn copy_selection(
    connection: &Connection,
    impact: &ResourceImpact,
    roots: &HashSet<String>,
    folder_id: Option<&str>,
    result: &mut ResourceImpact,
    copy_cover: &mut impl FnMut(
        &Connection,
        &Resource,
        &str,
    ) -> Result<Option<String>, PersistenceError>,
) -> Result<(), PersistenceError> {
    let mut mapping = HashMap::new();
    let mut remaining = impact.folders.clone();
    while !remaining.is_empty() {
        let ready: Vec<_> = remaining
            .iter()
            .filter(|folder| {
                roots.contains(&folder.id)
                    || folder
                        .parent_id
                        .as_ref()
                        .is_some_and(|parent| mapping.contains_key(parent))
            })
            .cloned()
            .collect();
        if ready.is_empty() {
            return Err(invalid(crate::api::UserMessage::ResourceFolderCycle));
        }
        for original in &ready {
            let id = uuid::Uuid::new_v4().to_string();
            let mut folder = original.clone();
            folder.id.clone_from(&id);
            folder.revision = 0;
            folder.parent_id = if roots.contains(&original.id) {
                folder_id.map(str::to_owned)
            } else {
                original
                    .parent_id
                    .as_ref()
                    .and_then(|parent| mapping.get(parent).cloned())
            };
            let siblings = folders_on(connection)?;
            let base = folder.name.clone();
            let mut suffix = 1;
            while siblings.iter().any(|other| {
                other.parent_id == folder.parent_id
                    && other.name.to_lowercase() == folder.name.to_lowercase()
            }) {
                suffix += 1;
                folder.name = format!("{base} ({suffix})");
            }
            result.folders.push(save_folder_on(connection, &folder)?);
            mapping.insert(original.id.clone(), id);
        }
        remaining.retain(|folder| !ready.iter().any(|candidate| candidate.id == folder.id));
    }
    let resource_mapping: HashMap<_, _> = impact
        .resources
        .iter()
        .map(|resource| (resource.id.clone(), uuid::Uuid::new_v4().to_string()))
        .collect();
    for original in &impact.resources {
        let mut resource =
            get_resource(connection, &original.id)?.ok_or_else(|| PersistenceError::NotFound {
                kind: "resource",
                id: original.id.clone(),
            })?;
        let id = resource_mapping[&resource.id].clone();
        resource.cover_asset_id = copy_cover(connection, &resource, &id)?;
        resource.id = id;
        resource.revision = 0;
        resource.folder_id = original
            .folder_id
            .as_ref()
            .and_then(|parent| mapping.get(parent).cloned())
            .or_else(|| folder_id.map(str::to_owned));
        // Copies of a selected preset use the selected chunk copies, preserving the copied collection.
        remap_content(&mut resource.content, &resource_mapping);
        result
            .resources
            .push(summary(&save_resource_on(connection, &resource)?));
    }

    Ok(())
}

#[cfg(test)]
mod tests;

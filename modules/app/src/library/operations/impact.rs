//! Reference impact queries preserve direct and transitive consumers.
use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension as _};

use super::folders_on;
use crate::{
    library::{
        ResourceFolder, ResourceImpact, ResourceSelection,
        sqlite::{all_resources, summary},
        validate_id,
    },
    persistence::PersistenceError,
};

fn selected_folders(
    selection: &ResourceSelection,
    folders: &[ResourceFolder],
) -> Result<HashSet<String>, PersistenceError> {
    let mut selected = HashSet::new();
    for version in &selection.folders {
        validate_id(&version.id)?;
        let folder = folders
            .iter()
            .find(|folder| folder.id == version.id)
            .ok_or_else(|| PersistenceError::NotFound {
                kind: "resource folder",
                id: version.id.clone(),
            })?;
        if folder.revision != version.revision {
            return Err(PersistenceError::Conflict {
                kind: "resource folder",
                id: version.id.clone(),
            });
        }
        selected.insert(folder.id.clone());
    }
    loop {
        let before = selected.len();
        for folder in folders {
            if folder
                .parent_id
                .as_ref()
                .is_some_and(|parent| selected.contains(parent))
            {
                selected.insert(folder.id.clone());
            }
        }
        if before == selected.len() {
            break;
        }
    }
    Ok(selected)
}

pub(super) fn contains_reference(value: &serde_json::Value, ids: &HashSet<String>) -> bool {
    match value {
        serde_json::Value::Object(values) => values.iter().any(|(key, value)| {
            (key == "resourceId" && value.as_str().is_some_and(|id| ids.contains(id)))
                || contains_reference(value, ids)
        }),
        serde_json::Value::Array(values) => {
            values.iter().any(|value| contains_reference(value, ids))
        },
        _ => false,
    }
}

pub(crate) fn impact_on(
    connection: &Connection,
    selection: &ResourceSelection,
) -> Result<ResourceImpact, PersistenceError> {
    let folders = folders_on(connection)?;
    let selected_folders = selected_folders(selection, &folders)?;
    let all = all_resources(connection)?;
    let mut ids = HashSet::new();
    for version in &selection.resources {
        validate_id(&version.id)?;
        let resource = all
            .iter()
            .find(|resource| resource.id == version.id)
            .ok_or_else(|| PersistenceError::NotFound {
                kind: "resource",
                id: version.id.clone(),
            })?;
        if resource.revision != version.revision {
            return Err(PersistenceError::Conflict {
                kind: "resource",
                id: version.id.clone(),
            });
        }
        ids.insert(resource.id.clone());
    }
    for resource in &all {
        if resource
            .folder_id
            .as_ref()
            .is_some_and(|folder| selected_folders.contains(folder))
        {
            ids.insert(resource.id.clone());
        }
    }
    let resources = all
        .iter()
        .filter(|resource| ids.contains(&resource.id))
        .map(summary)
        .collect();
    let selected = ids.clone();
    // Include indirect consumers, so a draft using a preset also reports a deleted chunk.
    loop {
        let before = ids.len();
        for resource in &all {
            let value = serde_json::to_value(&resource.content)
                .map_err(|error| PersistenceError::failure("inspect resource references", error))?;
            if contains_reference(&value, &ids) {
                ids.insert(resource.id.clone());
            }
        }
        if before == ids.len() {
            break;
        }
    }
    let referencing_resources = all
        .iter()
        .filter(|resource| ids.contains(&resource.id) && !selected.contains(&resource.id))
        .map(summary)
        .collect();
    let draft:Option<String>=connection.query_row("SELECT json_array(json(composition),json(presets),json(characters)) FROM current_creation WHERE id=1",[],|row|row.get(0)).optional().map_err(|error|PersistenceError::failure("inspect current creation references",error))?;
    let current_creation = draft
        .map(|value| crate::persistence::decode::<serde_json::Value>(&value))
        .transpose()?
        .is_some_and(|value| contains_reference(&value, &ids));
    Ok(ResourceImpact {
        resources,
        folders: folders
            .into_iter()
            .filter(|folder| selected_folders.contains(&folder.id))
            .collect(),
        referencing_resources,
        current_creation,
    })
}

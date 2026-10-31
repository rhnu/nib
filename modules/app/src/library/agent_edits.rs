//! Atomic assistant resource changes and conditional restoration of explicit definitions.

use std::collections::BTreeMap;

use super::{ResourceSaveMode, ResourceSelection};
use crate::{
    agent::storage::{ResourceEdit, StoredChat},
    persistence::{PersistenceError, SqliteDatabase, encode},
    prompt::{
        Resource,
        sqlite::{get_resource, save_resource_on},
    },
};

impl SqliteDatabase {
    pub(crate) fn save_agent_resource(
        &self,
        resource: &Resource,
        mode: ResourceSaveMode,
        chat: &mut StoredChat,
    ) -> Result<Resource, PersistenceError> {
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin assistant resource change", error))?;
        let before = get_resource(&transaction, &resource.id)?;
        let after = save_resource_on(&transaction, resource, mode)?;
        let edit = ResourceEdit {
            before,
            after: after.clone(),
        };
        let mut edits = chat.edits.clone();
        edits.push(edit.clone());
        transaction
            .execute(
                "UPDATE agent_chat SET resource_edits_json=?1 WHERE id=1",
                [encode(&edits)?],
            )
            .map_err(|error| PersistenceError::failure("retain assistant resource undo", error))?;
        transaction.commit().map_err(|error| {
            PersistenceError::failure("commit assistant resource change", error)
        })?;
        chat.edits.push(edit);
        Ok(after)
    }

    pub(crate) fn undo_agent_resources(
        &self,
        edits: &[ResourceEdit],
    ) -> Result<(), PersistenceError> {
        let mut grouped: BTreeMap<&str, (Option<&Resource>, &Resource)> = BTreeMap::new();
        for edit in edits {
            grouped
                .entry(&edit.after.id)
                .and_modify(|(_, after)| *after = &edit.after)
                .or_insert((edit.before.as_ref(), &edit.after));
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin assistant resource undo", error))?;
        for (id, (_, after)) in &grouped {
            if get_resource(&transaction, id)?.as_ref() != Some(*after) {
                return Err(PersistenceError::Conflict {
                    kind: "resource",
                    id: (*id).to_owned(),
                });
            }
        }
        // Restore updates before considering removal of resources created by the assistant.
        for (before, _) in grouped.values() {
            if let Some(before) = before {
                save_resource_on(&transaction, before, ResourceSaveMode::Update)?;
            }
        }
        let created: Vec<_> = grouped
            .iter()
            .filter(|(_, (before, _))| before.is_none())
            .map(|(id, _)| (*id).to_owned())
            .collect();
        if !created.is_empty() {
            let impact = super::operations::impact_on(
                &transaction,
                &ResourceSelection {
                    resources: created.clone(),
                    folders: Vec::new(),
                },
            )?;
            if impact.current_creation
                || impact
                    .referencing_resources
                    .iter()
                    .any(|resource| !created.contains(&resource.id))
            {
                return Err(PersistenceError::Conflict {
                    kind: "resource referenced by current creation or library",
                    id: created[0].clone(),
                });
            }
            for id in created {
                transaction
                    .execute("DELETE FROM resources WHERE id=?1", [&id])
                    .map_err(|error| {
                        PersistenceError::failure("undo assistant resource creation", error)
                    })?;
                crate::media::references::remove_owner_on(&transaction, "resource", &id)?;
            }
        }
        transaction
            .execute(
                "UPDATE agent_chat SET resource_edits_json='[]' WHERE id=1",
                [],
            )
            .map_err(|error| PersistenceError::failure("clear assistant resource undo", error))?;
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("commit assistant resource undo", error))
    }
}

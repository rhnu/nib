//! Save-boundary structural validation; SDK parameter validation is deliberately separate.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::{Composition, PresetBinding, PromptNode, Resource, ResourceContent};
use crate::session::Draft;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
#[error("{field}: {message}")]
pub struct ValidationError {
    pub field: String,
    pub message: String,
}

fn invalid(field: &str, message: &str) -> ValidationError {
    ValidationError {
        field: field.into(),
        message: message.into(),
    }
}

fn nonempty(value: &str, field: &str) -> Result<(), ValidationError> {
    if value.trim().is_empty() {
        return Err(invalid(field, "must not be empty"));
    }
    Ok(())
}

fn composition(value: &Composition, expanded: bool) -> Result<(), ValidationError> {
    let mut ids = HashSet::new();
    for node in value.positive.iter().chain(&value.negative) {
        nonempty(node.id(), "composition.node.id")?;
        if !ids.insert(node.id()) {
            return Err(invalid(
                "composition.node.id",
                "duplicate node identity across scopes",
            ));
        }
        if let PromptNode::Chunk { resource_id, .. } = node {
            if expanded {
                return Err(invalid(
                    "composition",
                    "expanded presets must contain only text nodes",
                ));
            }
            nonempty(resource_id, "composition.node.resourceId")?;
        }
    }
    Ok(())
}

/// Checks resource identity, name and unambiguous composition entry identities.
///
/// # Errors
/// Returns the field and reason for the first structural violation.
pub fn validate_resource(resource: &Resource) -> Result<(), ValidationError> {
    nonempty(&resource.id, "id")?;
    nonempty(&resource.name, "name")?;
    if let ResourceContent::Preset {
        composition: nodes, ..
    } = &resource.content
    {
        composition(nodes, false)?;
    }
    Ok(())
}

/// Checks draft identity, names, entry identities and instance override structure.
///
/// # Errors
/// Returns the field and reason for the first structural violation.
pub fn validate_draft(draft: &Draft) -> Result<(), ValidationError> {
    nonempty(&draft.id, "id")?;
    nonempty(&draft.name, "name")?;
    composition(&draft.composition, false)?;
    let mut ids = HashSet::new();
    for instance in &draft.presets {
        nonempty(&instance.id, "presets.id")?;
        if !ids.insert(&instance.id) {
            return Err(invalid("presets.id", "duplicate preset instance identity"));
        }
        match &instance.binding {
            PresetBinding::Linked {
                resource_id,
                overrides,
            } => {
                nonempty(resource_id, "presets.resourceId")?;
                let mut targets = HashSet::new();
                for edit in overrides {
                    nonempty(&edit.node_id, "presets.overrides.nodeId")?;
                    if !targets.insert(&edit.node_id) {
                        return Err(invalid(
                            "presets.overrides.nodeId",
                            "duplicate override target",
                        ));
                    }
                }
            },
            PresetBinding::Expanded {
                name,
                composition: nodes,
                ..
            } => {
                nonempty(name, "presets.name")?;
                composition(nodes, true)?;
            },
        }
    }
    Ok(())
}

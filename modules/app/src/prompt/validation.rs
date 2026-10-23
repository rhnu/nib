//! Save-boundary structural validation; SDK parameter validation is deliberately separate.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::{
    CharacterComposition, Composition, PresetBinding, PresetInstance, PresetOutputOverrides,
    PromptNode, Resource, ResourceContent,
};
use crate::session::ReferenceInputs;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
#[error("{field}: {message}")]
pub struct ValidationError {
    pub field: String,
    pub message: String,
}

pub(crate) fn invalid(field: &str, message: &str) -> ValidationError {
    ValidationError {
        field: field.into(),
        message: message.into(),
    }
}

pub(crate) fn nonempty(value: &str, field: &str) -> Result<(), ValidationError> {
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

pub(crate) fn outputs(
    base: &Composition,
    characters: &[CharacterComposition],
    references: &ReferenceInputs,
    expanded: bool,
) -> Result<(), ValidationError> {
    composition(base, expanded)?;
    let mut character_ids = HashSet::new();
    let mut node_ids: HashSet<&str> = base
        .positive
        .iter()
        .chain(&base.negative)
        .map(PromptNode::id)
        .collect();
    for character in characters {
        nonempty(&character.id, "characters.id")?;
        if !character_ids.insert(&character.id) {
            return Err(invalid("characters.id", "duplicate character identity"));
        }
        composition(&character.composition, expanded)?;
        for node in character
            .composition
            .positive
            .iter()
            .chain(&character.composition.negative)
        {
            if !node_ids.insert(node.id()) {
                return Err(invalid(
                    "composition.node.id",
                    "duplicate node identity across prompt targets",
                ));
            }
        }
    }
    let mut reference_ids = HashSet::new();
    for (id, asset_id) in references
        .precise
        .iter()
        .map(|value| (value.id.as_str(), value.asset_id.as_str()))
        .chain(
            references
                .vibes
                .iter()
                .map(|value| (value.id.as_str(), value.input.asset_id())),
        )
    {
        nonempty(id, "references.id")?;
        nonempty(asset_id, "references.assetId")?;
        if !reference_ids.insert(id) {
            return Err(invalid("references.id", "duplicate reference identity"));
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
        composition: nodes,
        characters,
        references,
        ..
    } = &resource.content
    {
        outputs(nodes, characters, references, false)?;
    }
    Ok(())
}

pub(crate) fn validate_presets(presets: &[PresetInstance]) -> Result<(), ValidationError> {
    let mut ids = HashSet::new();
    for instance in presets {
        nonempty(&instance.id, "presets.id")?;
        if !ids.insert(&instance.id) {
            return Err(invalid("presets.id", "duplicate preset instance identity"));
        }
        match &instance.binding {
            PresetBinding::Linked {
                resource_id,
                overrides,
                output_overrides,
                ..
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
                validate_output_overrides(output_overrides)?;
            },
            PresetBinding::Expanded {
                name,
                composition: nodes,
                characters,
                references,
                ..
            } => {
                nonempty(name, "presets.name")?;
                outputs(nodes, characters, references, true)?;
            },
        }
    }
    Ok(())
}

fn validate_output_overrides(
    output_overrides: &PresetOutputOverrides,
) -> Result<(), ValidationError> {
    for (field, values) in [
        (
            "presets.outputOverrides.characters",
            output_overrides
                .characters
                .iter()
                .map(|edit| edit.character_id.as_str())
                .collect::<Vec<_>>(),
        ),
        (
            "presets.outputOverrides.precise",
            output_overrides
                .precise
                .iter()
                .map(|edit| edit.id.as_str())
                .collect(),
        ),
        (
            "presets.outputOverrides.vibes",
            output_overrides
                .vibes
                .iter()
                .map(|edit| edit.id.as_str())
                .collect(),
        ),
    ] {
        let mut targets = HashSet::new();
        for id in values {
            nonempty(id, field)?;
            if !targets.insert(id) {
                return Err(invalid(field, "duplicate output override target"));
            }
        }
    }
    for asset_id in output_overrides
        .precise
        .iter()
        .filter_map(|edit| edit.asset_id.as_deref())
        .chain(
            output_overrides
                .vibes
                .iter()
                .filter_map(|edit| edit.input.as_ref().map(crate::session::VibeInput::asset_id)),
        )
    {
        nonempty(asset_id, "presets.outputOverrides.assetId")?;
    }
    Ok(())
}

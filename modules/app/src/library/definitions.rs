use std::collections::HashSet;

use crate::{
    persistence::PersistenceError,
    prompt::{Composition, PresetBinding, PromptNode, Resource, ResourceContent, ResourceReader},
    session::Draft,
};

fn composition_ids(composition: &Composition, ids: &mut Vec<String>) {
    ids.extend(
        composition
            .positive
            .iter()
            .chain(&composition.negative)
            .filter_map(|node| {
                if let PromptNode::Chunk { resource_id, .. } = node {
                    Some(resource_id.clone())
                } else {
                    None
                }
            }),
    );
}

/// Includes disabled entries because the editor can inspect and enable them.
#[must_use]
pub fn draft_resource_ids(draft: &Draft) -> Vec<String> {
    let mut ids = Vec::new();
    composition_ids(&draft.composition, &mut ids);
    for character in &draft.characters {
        composition_ids(&character.composition, &mut ids);
    }
    for preset in &draft.presets {
        match &preset.binding {
            PresetBinding::Linked { resource_id, .. } => ids.push(resource_id.clone()),
            PresetBinding::Expanded {
                composition,
                characters,
                ..
            } => {
                composition_ids(composition, &mut ids);
                for character in characters {
                    composition_ids(&character.composition, &mut ids);
                }
            },
        }
    }
    ids
}

/// Reads a batch and its recipe dependencies within the caller's resource snapshot.
/// Missing definitions stay absent so existing references can display their diagnostics.
///
/// # Errors
/// Returns a resource read or decoding failure.
pub fn resource_definitions(
    ids: &[String],
    reader: &(impl ResourceReader + ?Sized),
) -> Result<Vec<Resource>, PersistenceError> {
    let mut pending = ids.to_vec();
    let mut seen = HashSet::new();
    let mut resources = Vec::new();
    while let Some(id) = pending.pop() {
        if !seen.insert(id.clone()) {
            continue;
        }
        if let Some(resource) = reader.get_resource(&id)? {
            if let ResourceContent::Preset {
                composition,
                characters,
                ..
            } = &resource.content
            {
                composition_ids(composition, &mut pending);
                for character in characters {
                    composition_ids(&character.composition, &mut pending);
                }
            }
            resources.push(resource);
        }
    }
    Ok(resources)
}

#[cfg(test)]
mod tests;

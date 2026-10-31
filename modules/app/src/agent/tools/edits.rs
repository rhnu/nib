//! Pure typed edits and composition conversion used by assistant tools.

use serde::Deserialize;
use serde_json::Value;

use crate::{
    agent::AgentError,
    prompt::{
        self, CharacterComposition, Composition, GenerationSettings, PresetBinding, PromptNode,
        ResourceContent, ResourceReader,
    },
    session::{Draft, ReferenceInputs},
};

/// A finite list of generation fields, not a general JSON path or patch interpreter.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum GenerationField {
    Model,
    Size,
    Steps,
    Scale,
    Sampler,
    Seed,
    NSamples,
    Quality,
    UcPreset,
    LegacyUc,
    TransparentBackground,
    FurryMode,
    NoiseSchedule,
    CfgRescale,
    VarietyBoost,
    Decrisp,
    Smea,
    SmeaDyn,
    ImageFormat,
    AlphaMode,
    ResponseFormat,
    UseCoords,
}

pub(super) fn patch_settings(
    settings: &mut GenerationSettings,
    changes: serde_json::Map<String, Value>,
) -> Result<(), AgentError> {
    for (field, value) in changes {
        let field: GenerationField = serde_json::from_value(Value::String(field))
            .map_err(|_error| AgentError::Invalid("The generation setting field is unknown."))?;
        macro_rules! assign {
            ($target:ident) => {
                settings.$target = serde_json::from_value(value).map_err(|_error| {
                    AgentError::Invalid("The generation setting value has the wrong type.")
                })?
            };
        }
        match field {
            GenerationField::Model => assign!(model),
            GenerationField::Size => assign!(size),
            GenerationField::Steps => assign!(steps),
            GenerationField::Scale => assign!(scale),
            GenerationField::Sampler => assign!(sampler),
            GenerationField::Seed => assign!(seed),
            GenerationField::NSamples => assign!(n_samples),
            GenerationField::Quality => assign!(quality),
            GenerationField::UcPreset => assign!(uc_preset),
            GenerationField::LegacyUc => assign!(legacy_uc),
            GenerationField::TransparentBackground => assign!(transparent_background),
            GenerationField::FurryMode => assign!(furry_mode),
            GenerationField::NoiseSchedule => assign!(noise_schedule),
            GenerationField::CfgRescale => assign!(cfg_rescale),
            GenerationField::VarietyBoost => assign!(variety_boost),
            GenerationField::Decrisp => assign!(decrisp),
            GenerationField::Smea => assign!(smea),
            GenerationField::SmeaDyn => assign!(smea_dyn),
            GenerationField::ImageFormat => assign!(image_format),
            GenerationField::AlphaMode => assign!(alpha_mode),
            GenerationField::ResponseFormat => assign!(response_format),
            GenerationField::UseCoords => assign!(use_coords),
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct NodeEdit {
    instance_id: Option<String>,
    character_id: Option<String>,
    node_id: String,
    text: Option<String>,
    enabled: Option<bool>,
}

fn composition<'a>(
    base: &'a mut Composition,
    characters: &'a mut [CharacterComposition],
    character_id: Option<&str>,
) -> Result<&'a mut Composition, AgentError> {
    if let Some(id) = character_id {
        characters
            .iter_mut()
            .find(|character| character.id == id)
            .map(|character| &mut character.composition)
            .ok_or(AgentError::Invalid(
                "The character identity no longer exists.",
            ))
    } else {
        Ok(base)
    }
}

fn node<'a>(composition: &'a mut Composition, id: &str) -> Result<&'a mut PromptNode, AgentError> {
    composition
        .positive
        .iter_mut()
        .chain(&mut composition.negative)
        .find(|node| node.id() == id)
        .ok_or(AgentError::Invalid(
            "The prompt node identity no longer exists in this scope.",
        ))
}

fn apply(node: &mut PromptNode, edit: &NodeEdit) {
    match node {
        PromptNode::Text { text, enabled, .. } => {
            if let Some(value) = &edit.text {
                text.clone_from(value);
            }
            if let Some(value) = edit.enabled {
                *enabled = value;
            }
        },
        PromptNode::Chunk {
            override_text,
            enabled,
            ..
        } => {
            if let Some(value) = &edit.text {
                *override_text = Some(value.clone());
            }
            if let Some(value) = edit.enabled {
                *enabled = value;
            }
        },
    }
}

pub(super) fn edit_node(
    draft: &mut Draft,
    edit: &NodeEdit,
    reader: &impl ResourceReader,
) -> Result<(), AgentError> {
    if let Some(id) = &edit.instance_id {
        let instance = draft
            .presets
            .iter_mut()
            .find(|instance| &instance.id == id)
            .ok_or(AgentError::Invalid("The preset instance no longer exists."))?;
        if matches!(instance.binding, PresetBinding::Linked { .. }) {
            // Expansion validates both the original target and all existing instance overrides.
            let expanded = prompt::expand_preset(instance, reader).map_err(expansion_error)?;
            let PresetBinding::Expanded {
                mut composition,
                mut characters,
                ..
            } = expanded.binding
            else {
                unreachable!("expansion returns expanded binding")
            };
            node(
                self::composition(
                    &mut composition,
                    &mut characters,
                    edit.character_id.as_deref(),
                )?,
                &edit.node_id,
            )?;
            let PresetBinding::Linked { overrides, .. } = &mut instance.binding else {
                unreachable!("the original binding was linked")
            };
            let index = if let Some(index) = overrides
                .iter()
                .position(|entry| entry.node_id == edit.node_id)
            {
                index
            } else {
                overrides.push(prompt::InstanceOverride {
                    node_id: edit.node_id.clone(),
                    text: None,
                    enabled: None,
                });
                overrides.len() - 1
            };
            let entry = &mut overrides[index];
            if let Some(text) = &edit.text {
                entry.text = Some(text.clone());
            }
            if let Some(enabled) = edit.enabled {
                entry.enabled = Some(enabled);
            }
        } else if let PresetBinding::Expanded {
            composition,
            characters,
            ..
        } = &mut instance.binding
        {
            apply(
                node(
                    self::composition(composition, characters, edit.character_id.as_deref())?,
                    &edit.node_id,
                )?,
                edit,
            );
        }
    } else {
        apply(
            node(
                composition(
                    &mut draft.composition,
                    &mut draft.characters,
                    edit.character_id.as_deref(),
                )?,
                &edit.node_id,
            )?,
            edit,
        );
    }
    Ok(())
}

fn expansion_error(error: prompt::ExpansionError) -> AgentError {
    match error {
        prompt::ExpansionError::Persistence(error) => error.into(),
        prompt::ExpansionError::Unresolved { .. } => AgentError::Invalid(
            "The preset or chunk could not be expanded because a dependency or instance override is invalid. Resolve the creation to inspect the diagnostics.",
        ),
    }
}

fn inline(
    composition: &Composition,
    reader: &impl ResourceReader,
    enabled: bool,
) -> Result<Composition, AgentError> {
    fn nodes(
        nodes: &[PromptNode],
        reader: &impl ResourceReader,
        enabled: bool,
    ) -> Result<Vec<PromptNode>, AgentError> {
        nodes
            .iter()
            .map(|node| {
                let mut node = prompt::expand_chunk(node, reader).map_err(expansion_error)?;
                let PromptNode::Text {
                    id,
                    enabled: active,
                    ..
                } = &mut node
                else {
                    unreachable!("chunk expansion returns text")
                };
                *id = uuid::Uuid::new_v4().to_string();
                *active &= enabled;
                Ok(node)
            })
            .collect()
    }
    Ok(Composition {
        positive: nodes(&composition.positive, reader, enabled)?,
        negative: nodes(&composition.negative, reader, enabled)?,
    })
}

pub(super) fn preset_content(
    draft: &Draft,
    reader: &impl ResourceReader,
) -> Result<ResourceContent, AgentError> {
    let resolved = prompt::resolve_draft(draft, reader)?;
    if !resolved.issues.is_empty() {
        return Err(AgentError::Invalid(
            "Resolve the current creation's missing resources or invalid overrides before saving it as a preset.",
        ));
    }
    let mut composition = Composition::default();
    let mut characters = Vec::new();
    let mut references = ReferenceInputs::default();
    for instance in &draft.presets {
        let expanded = prompt::expand_preset(instance, reader).map_err(expansion_error)?;
        let PresetBinding::Expanded {
            composition: layer,
            characters: roles,
            references: inputs,
            ..
        } = expanded.binding
        else {
            unreachable!("preset expansion returns expanded binding")
        };
        let layer = inline(&layer, reader, instance.enabled)?;
        composition.positive.extend(layer.positive);
        composition.negative.extend(layer.negative);
        append_outputs(
            &mut characters,
            &mut references,
            &roles,
            &inputs,
            reader,
            instance.enabled,
        )?;
    }
    let direct = inline(&draft.composition, reader, true)?;
    composition.positive.extend(direct.positive);
    composition.negative.extend(direct.negative);
    append_outputs(
        &mut characters,
        &mut references,
        &draft.characters,
        &draft.inputs.references,
        reader,
        true,
    )?;
    references.normalize_vibe_strength = resolved.inputs.references.normalize_vibe_strength;
    Ok(ResourceContent::Preset {
        composition,
        defaults: resolved.settings.explicit(),
        characters,
        references,
    })
}

fn append_outputs(
    characters: &mut Vec<CharacterComposition>,
    references: &mut ReferenceInputs,
    roles: &[CharacterComposition],
    inputs: &ReferenceInputs,
    reader: &impl ResourceReader,
    enabled: bool,
) -> Result<(), AgentError> {
    for role in roles {
        let mut role = role.clone();
        role.id = uuid::Uuid::new_v4().to_string();
        role.enabled &= enabled;
        role.composition = inline(&role.composition, reader, true)?;
        characters.push(role);
    }
    for input in &inputs.precise {
        let mut input = input.clone();
        input.id = uuid::Uuid::new_v4().to_string();
        input.enabled &= enabled;
        references.precise.push(input);
    }
    for input in &inputs.vibes {
        let mut input = input.clone();
        input.id = uuid::Uuid::new_v4().to_string();
        input.enabled &= enabled;
        references.vibes.push(input);
    }
    Ok(())
}

#[cfg(test)]
mod tests;

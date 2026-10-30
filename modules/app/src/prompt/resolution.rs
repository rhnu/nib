//! Ordered prompt composition and explicit application setting precedence.

use super::{
    CharacterComposition, Composition, GenerationSettings, InstanceOverride, PresetBinding,
    PresetInstance, PresetOutputOverrides, PromptNode, Resource, ResourceContent, ResourceReader,
};
use crate::{
    api::UserMessage,
    persistence::PersistenceError,
    session::{CreationInputs, Draft, ReferenceInputs},
};

mod layers;
mod outputs;
mod types;
use layers::ResolutionState;
use outputs::{apply_output_overrides, resolve_outputs};
pub use types::{
    ExpansionError, InputProvenance, PromptScope, ResolutionIssue, ResolutionIssueKind,
    ResolvedCharacter, ResolvedDraft, ResolvedFragment, SettingSource, SettingsProvenance,
};

#[derive(Clone, Copy, Default)]
struct Context<'a> {
    instance_id: Option<&'a str>,
    resource: Option<&'a Resource>,
    expanded: bool,
    character_id: Option<&'a str>,
}

fn issue(
    kind: ResolutionIssueKind,
    scope: Option<PromptScope>,
    node_id: Option<&str>,
    context: Context<'_>,
    resource_id: Option<&str>,
    message: UserMessage,
) -> ResolutionIssue {
    ResolutionIssue {
        kind,
        character_id: context.character_id.map(str::to_owned),
        scope,
        node_id: node_id.map(str::to_owned),
        preset_instance_id: context.instance_id.map(str::to_owned),
        resource_id: resource_id.map(str::to_owned),
        message,
    }
}

fn lookup(
    id: &str,
    preset: bool,
    scope: Option<PromptScope>,
    node_id: Option<&str>,
    context: Context<'_>,
    reader: &(impl ResourceReader + ?Sized),
    issues: &mut Vec<ResolutionIssue>,
) -> Result<Option<Resource>, PersistenceError> {
    let Some(resource) = reader.get_resource(id)? else {
        issues.push(issue(
            ResolutionIssueKind::MissingResource,
            scope,
            node_id,
            context,
            Some(id),
            UserMessage::MissingResource { id: id.to_owned() },
        ));
        return Ok(None);
    };
    if matches!(resource.content, ResourceContent::Preset { .. }) != preset {
        issues.push(issue(
            ResolutionIssueKind::TypeMismatch,
            scope,
            node_id,
            context,
            Some(id),
            UserMessage::ResourceTypeMismatch {
                id: id.to_owned(),
                expected: if preset {
                    crate::library::ResourceKind::Preset
                } else {
                    crate::library::ResourceKind::Chunk
                },
            },
        ));
        return Ok(None);
    }
    Ok(Some(resource))
}

fn apply_override(node: &PromptNode, edits: &[InstanceOverride]) -> (PromptNode, bool) {
    let Some(edit) = edits.iter().find(|edit| edit.node_id == node.id()) else {
        return (node.clone(), false);
    };
    let mut result = node.clone();
    match &mut result {
        PromptNode::Text { enabled, text, .. } => {
            if let Some(value) = edit.enabled {
                *enabled = value;
            }
            if let Some(value) = &edit.text {
                text.clone_from(value);
            }
        },
        PromptNode::Chunk {
            enabled,
            override_text,
            ..
        } => {
            if let Some(value) = edit.enabled {
                *enabled = value;
            }
            if let Some(value) = &edit.text {
                *override_text = Some(value.clone());
            }
        },
    }
    (result, edit.enabled.is_some() || edit.text.is_some())
}

fn stale_overrides(
    composition: &Composition,
    edits: &[InstanceOverride],
    context: Context<'_>,
    issues: &mut Vec<ResolutionIssue>,
) {
    for edit in edits {
        if !composition
            .positive
            .iter()
            .chain(&composition.negative)
            .any(|node| node.id() == edit.node_id)
        {
            issues.push(issue(
                ResolutionIssueKind::StaleOverride,
                None,
                Some(&edit.node_id),
                context,
                context.resource.map(|resource| resource.id.as_str()),
                UserMessage::StaleNodeOverride {
                    id: edit.node_id.clone(),
                },
            ));
        }
    }
}

fn stale_output_overrides(
    composition: &Composition,
    characters: &[CharacterComposition],
    edits: &[InstanceOverride],
    context: Context<'_>,
    issues: &mut Vec<ResolutionIssue>,
) {
    let mut targets = composition.clone();
    for character in characters {
        targets
            .positive
            .extend(character.composition.positive.iter().cloned());
        targets
            .negative
            .extend(character.composition.negative.iter().cloned());
    }
    stale_overrides(&targets, edits, context, issues);
}

fn inline_composition(
    composition: &Composition,
    overrides: &[InstanceOverride],
    context: Context<'_>,
    reader: &(impl ResourceReader + ?Sized),
    issues: &mut Vec<ResolutionIssue>,
) -> Result<Composition, PersistenceError> {
    let mut result = Composition::default();
    for (scope, nodes, output) in [
        (
            PromptScope::Positive,
            &composition.positive,
            &mut result.positive,
        ),
        (
            PromptScope::Negative,
            &composition.negative,
            &mut result.negative,
        ),
    ] {
        for node in nodes {
            let (node, _) = apply_override(node, overrides);
            if let Some(node) = inline_node(&node, Some(scope), context, reader, issues)? {
                output.push(node);
            }
        }
    }
    Ok(result)
}

fn node_fragment(
    node: &PromptNode,
    scope: PromptScope,
    overridden: bool,
    context: Context<'_>,
    reader: &(impl ResourceReader + ?Sized),
    issues: &mut Vec<ResolutionIssue>,
) -> Result<Option<ResolvedFragment>, PersistenceError> {
    if !node.enabled() {
        return Ok(None);
    }
    let (text, resource_id, resource_name, overridden) = match node {
        PromptNode::Text { text, .. } => (
            text.clone(),
            context.resource.map(|resource| resource.id.clone()),
            context.resource.map(|resource| resource.name.clone()),
            overridden,
        ),
        PromptNode::Chunk {
            resource_id,
            override_text,
            ..
        } => {
            let Some(resource) = lookup(
                resource_id,
                false,
                Some(scope),
                Some(node.id()),
                context,
                reader,
                issues,
            )?
            else {
                return Ok(None);
            };
            let ResourceContent::Chunk { text } = &resource.content else {
                unreachable!("lookup checks resource kind")
            };
            (
                override_text.as_ref().unwrap_or(text).clone(),
                Some(resource.id),
                Some(resource.name),
                overridden || override_text.is_some(),
            )
        },
    };
    let text = text.trim().to_owned();
    if text.is_empty() {
        return Ok(None);
    }
    Ok(Some(ResolvedFragment {
        text,
        scope,
        node_id: node.id().to_owned(),
        preset_instance_id: context.instance_id.map(str::to_owned),
        resource_id,
        resource_name,
        overridden,
        expanded: context.expanded,
    }))
}

fn resolve_composition(
    composition: &Composition,
    edits: &[InstanceOverride],
    context: Context<'_>,
    reader: &(impl ResourceReader + ?Sized),
    fragments: &mut Vec<ResolvedFragment>,
    issues: &mut Vec<ResolutionIssue>,
) -> Result<(), PersistenceError> {
    for (scope, nodes) in [
        (PromptScope::Positive, &composition.positive),
        (PromptScope::Negative, &composition.negative),
    ] {
        for node in nodes {
            let (node, overridden) = apply_override(node, edits);
            if let Some(fragment) =
                node_fragment(&node, scope, overridden, context, reader, issues)?
            {
                fragments.push(fragment);
            }
        }
    }
    Ok(())
}

/// Resolves enabled references in instance order, then appends draft-local nodes.
/// Missing definitions are editable issues; a storage failure remains an error.
///
/// # Errors
/// Returns the original backend failure if a referenced resource cannot be read.
pub fn resolve_draft(
    draft: &Draft,
    reader: &(impl ResourceReader + ?Sized),
) -> Result<ResolvedDraft, PersistenceError> {
    let mut state = ResolutionState::default();
    for instance in draft.presets.iter().filter(|instance| instance.enabled) {
        state.resolve_preset(instance, reader)?;
    }
    resolve_outputs(
        &draft.characters,
        &draft.inputs.references,
        &PresetOutputOverrides::default(),
        &[],
        Context::default(),
        reader,
        &mut state.characters,
        &mut state.references,
        &mut state.input_sources,
        &mut state.issues,
    )?;
    resolve_composition(
        &draft.composition,
        &[],
        Context::default(),
        reader,
        &mut state.fragments,
        &mut state.issues,
    )?;
    state.settings.overlay(
        &draft.settings,
        &mut state.provenance,
        &SettingSource::Draft,
    );
    let mut resolved = finish_resolution(
        &state.settings,
        state.provenance,
        state.fragments,
        state.issues,
    );
    resolved.characters = state.characters;
    resolved.inputs = CreationInputs {
        references: state.references,
        ..draft.inputs.clone()
    };
    resolved.input_sources = state.input_sources;
    Ok(resolved)
}

fn finish_resolution(
    settings: &GenerationSettings,
    provenance: SettingsProvenance,
    fragments: Vec<ResolvedFragment>,
    issues: Vec<ResolutionIssue>,
) -> ResolvedDraft {
    let settings = settings.resolve();
    let join = |scope| {
        fragments
            .iter()
            .filter(|fragment| fragment.scope == scope)
            .map(|fragment| fragment.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    };
    ResolvedDraft {
        positive: join(PromptScope::Positive),
        negative: join(PromptScope::Negative),
        fragments,
        settings,
        provenance,
        issues,
        characters: Vec::new(),
        inputs: CreationInputs::default(),
        input_sources: Vec::new(),
    }
}

fn inline_node(
    node: &PromptNode,
    scope: Option<PromptScope>,
    context: Context<'_>,
    reader: &(impl ResourceReader + ?Sized),
    issues: &mut Vec<ResolutionIssue>,
) -> Result<Option<PromptNode>, PersistenceError> {
    match node {
        PromptNode::Text { .. } => Ok(Some(node.clone())),
        PromptNode::Chunk {
            id,
            enabled,
            resource_id,
            override_text,
        } => {
            let Some(resource) =
                lookup(resource_id, false, scope, Some(id), context, reader, issues)?
            else {
                return Ok(None);
            };
            let ResourceContent::Chunk { text } = resource.content else {
                unreachable!("lookup checks resource kind")
            };
            Ok(Some(PromptNode::Text {
                id: id.clone(),
                enabled: *enabled,
                text: override_text.clone().unwrap_or(text),
            }))
        },
    }
}

/// Detaches a single chunk without modifying its identity or enabled state.
///
/// # Errors
/// Returns a storage failure, or diagnostics for missing or wrong-kind resources.
pub fn expand_chunk(
    node: &PromptNode,
    reader: &(impl ResourceReader + ?Sized),
) -> Result<PromptNode, ExpansionError> {
    let mut issues = Vec::new();
    let result = inline_node(node, None, Context::default(), reader, &mut issues)?;
    result.ok_or(ExpansionError::Unresolved { issues })
}

/// Detaches the whole recipe atomically, including currently disabled entries.
/// Disabled dependencies must also exist so re-enabling the expanded recipe remains possible.
///
/// # Errors
/// Returns a storage failure, or diagnostics for missing dependencies, wrong resource
/// kinds or stale override targets. No partial expansion is returned.
pub fn expand_preset(
    instance: &PresetInstance,
    reader: &(impl ResourceReader + ?Sized),
) -> Result<PresetInstance, ExpansionError> {
    let PresetBinding::Linked {
        resource_id,
        overrides,
        output_overrides,
        settings_overrides,
    } = &instance.binding
    else {
        return Ok(instance.clone());
    };
    let mut issues = Vec::new();
    let context = Context {
        instance_id: Some(&instance.id),
        ..Context::default()
    };
    let Some(resource) = lookup(resource_id, true, None, None, context, reader, &mut issues)?
    else {
        return Err(ExpansionError::Unresolved { issues });
    };
    let ResourceContent::Preset {
        composition,
        defaults,
        characters,
        references,
    } = &resource.content
    else {
        unreachable!("lookup checks resource kind")
    };
    let context = Context {
        resource: Some(&resource),
        ..context
    };
    let (characters, references) = apply_output_overrides(
        characters,
        references,
        output_overrides,
        context,
        &mut issues,
    );
    stale_output_overrides(composition, &characters, overrides, context, &mut issues);
    let expanded = inline_composition(composition, overrides, context, reader, &mut issues)?;
    let mut expanded_characters = Vec::new();
    for character in &characters {
        let mut character = character.clone();
        character.composition = inline_composition(
            &character.composition,
            overrides,
            Context {
                character_id: Some(&character.id),
                ..context
            },
            reader,
            &mut issues,
        )?;
        expanded_characters.push(character);
    }
    if !issues.is_empty() {
        return Err(ExpansionError::Unresolved { issues });
    }
    let mut defaults = defaults.clone();
    defaults.overlay(
        settings_overrides,
        &mut SettingsProvenance::default(),
        &SettingSource::SdkDefault,
    );
    Ok(PresetInstance {
        id: instance.id.clone(),
        enabled: instance.enabled,
        binding: PresetBinding::Expanded {
            name: resource.name.clone(),
            composition: expanded,
            defaults,
            characters: expanded_characters,
            references,
        },
    })
}

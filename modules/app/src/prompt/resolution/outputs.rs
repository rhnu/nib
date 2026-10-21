//! Recipe character and reference output overrides with provenance.

use super::{
    CharacterComposition, Context, InputProvenance, InstanceOverride, PersistenceError,
    PresetOutputOverrides, PromptScope, ReferenceInputs, ResolutionIssue, ResolutionIssueKind,
    ResolvedCharacter, ResolvedFragment, ResourceReader, issue, resolve_composition,
};

fn join_fragments(fragments: &[ResolvedFragment], scope: PromptScope) -> String {
    fragments
        .iter()
        .filter(|fragment| fragment.scope == scope)
        .map(|fragment| fragment.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn missing_output_override<'a>(
    id: &'a str,
    character: bool,
    context: Context<'a>,
    issues: &mut Vec<ResolutionIssue>,
) {
    issues.push(issue(
        ResolutionIssueKind::StaleOverride,
        None,
        Some(id),
        Context {
            character_id: if character { Some(id) } else { None },
            ..context
        },
        context.resource.map(|resource| resource.id.as_str()),
        format!("Override target '{id}' no longer exists in this preset output."),
    ));
}

pub(super) fn apply_output_overrides(
    characters: &[CharacterComposition],
    references: &ReferenceInputs,
    edits: &PresetOutputOverrides,
    context: Context<'_>,
    issues: &mut Vec<ResolutionIssue>,
) -> (Vec<CharacterComposition>, ReferenceInputs) {
    let mut characters = characters.to_vec();
    let mut references = references.clone();
    macro_rules! fields {
        ($target:ident, $edit:ident, $($field:ident),+ $(,)?) => {
            $(if let Some(value) = &$edit.$field { $target.$field.clone_from(value); })+
        };
    }
    for edit in &edits.characters {
        if let Some(target) = characters
            .iter_mut()
            .find(|target| target.id == edit.character_id)
        {
            fields!(target, edit, enabled, position);
        } else {
            missing_output_override(&edit.character_id, true, context, issues);
        }
    }
    for edit in &edits.precise {
        if let Some(target) = references
            .precise
            .iter_mut()
            .find(|target| target.id == edit.id)
        {
            fields!(
                target,
                edit,
                enabled,
                asset_id,
                reference_type,
                strength,
                fidelity
            );
        } else {
            missing_output_override(&edit.id, false, context, issues);
        }
    }
    for edit in &edits.vibes {
        if let Some(target) = references
            .vibes
            .iter_mut()
            .find(|target| target.id == edit.id)
        {
            fields!(target, edit, enabled, asset_id, strength);
        } else {
            missing_output_override(&edit.id, false, context, issues);
        }
    }
    if edits.vibe_strength.is_some() {
        references.vibe_strength = edits.vibe_strength;
    }
    (characters, references)
}

#[expect(
    clippy::too_many_arguments,
    reason = "One ordered output resolution shares its accumulation state"
)]
pub(super) fn resolve_outputs(
    definitions: &[CharacterComposition],
    references: &ReferenceInputs,
    output_overrides: &PresetOutputOverrides,
    overrides: &[InstanceOverride],
    context: Context<'_>,
    reader: &(impl ResourceReader + ?Sized),
    characters: &mut Vec<ResolvedCharacter>,
    inputs: &mut ReferenceInputs,
    sources: &mut Vec<InputProvenance>,
    issues: &mut Vec<ResolutionIssue>,
) -> Result<(), PersistenceError> {
    let (definitions, references) =
        apply_output_overrides(definitions, references, output_overrides, context, issues);
    for definition in &definitions {
        let mut fragments = Vec::new();
        if definition.enabled {
            resolve_composition(
                &definition.composition,
                overrides,
                Context {
                    character_id: Some(&definition.id),
                    ..context
                },
                reader,
                &mut fragments,
                issues,
            )?;
        }
        characters.push(ResolvedCharacter {
            id: context.instance_id.map_or_else(
                || definition.id.clone(),
                |instance| format!("{instance}:{}", definition.id),
            ),
            enabled: definition.enabled,
            positive: join_fragments(&fragments, PromptScope::Positive),
            negative: join_fragments(&fragments, PromptScope::Negative),
            position: definition.position,
            fragments,
            preset_instance_id: context.instance_id.map(str::to_owned),
            resource_id: context.resource.map(|resource| resource.id.clone()),
            expanded: context.expanded,
            overridden: output_overrides
                .characters
                .iter()
                .any(|edit| edit.character_id == definition.id),
        });
    }
    let mut references = references;
    if let Some(instance) = context.instance_id {
        for reference in &mut references.precise {
            reference.id = format!("{instance}:{}", reference.id);
        }
        for reference in &mut references.vibes {
            reference.id = format!("{instance}:{}", reference.id);
        }
    }
    inputs.append(&references);
    for id in references
        .precise
        .iter()
        .map(|reference| &reference.id)
        .chain(references.vibes.iter().map(|reference| &reference.id))
    {
        sources.push(InputProvenance {
            id: id.clone(),
            overridden: output_overrides.precise.iter().any(|edit| {
                context.instance_id.map_or_else(
                    || edit.id.clone(),
                    |instance| format!("{instance}:{}", edit.id),
                ) == *id
            }) || output_overrides.vibes.iter().any(|edit| {
                context.instance_id.map_or_else(
                    || edit.id.clone(),
                    |instance| format!("{instance}:{}", edit.id),
                ) == *id
            }),
            preset_instance_id: context.instance_id.map(str::to_owned),
            resource_id: context.resource.map(|resource| resource.id.clone()),
            expanded: context.expanded,
        });
    }
    Ok(())
}

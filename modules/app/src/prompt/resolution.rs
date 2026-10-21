//! Ordered prompt composition and explicit application setting precedence.

use novelai_bridge::{ImageSize, Model, Sampler};
use serde::{Deserialize, Serialize};

use super::{
    Composition, GenerationSettings, InstanceOverride, PresetBinding, PresetInstance, PromptNode,
    Resource, ResourceContent, ResourceReader,
};
use crate::{persistence::PersistenceError, session::Draft};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum PromptScope {
    Positive,
    Negative,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum ResolutionIssueKind {
    MissingResource,
    TypeMismatch,
    StaleOverride,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResolutionIssue {
    pub kind: ResolutionIssueKind,
    pub scope: Option<PromptScope>,
    pub node_id: Option<String>,
    pub preset_instance_id: Option<String>,
    pub resource_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResolvedFragment {
    pub text: String,
    pub scope: PromptScope,
    pub node_id: String,
    pub preset_instance_id: Option<String>,
    pub resource_id: Option<String>,
    pub resource_name: Option<String>,
    pub overridden: bool,
    pub expanded: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResolvedSettings {
    #[cfg_attr(feature = "typegen", ts(type = "string"))]
    pub model: Model,
    #[cfg_attr(feature = "typegen", ts(type = "{ width: number; height: number }"))]
    pub size: ImageSize,
    pub steps: u32,
    pub scale: f32,
    #[cfg_attr(feature = "typegen", ts(type = "string"))]
    pub sampler: Sampler,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum SettingSource {
    #[default]
    SdkDefault,
    Preset {
        preset_instance_id: String,
        resource_id: Option<String>,
        name: String,
        expanded: bool,
    },
    Draft,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct SettingsProvenance {
    pub model: SettingSource,
    pub size: SettingSource,
    pub steps: SettingSource,
    pub scale: SettingSource,
    pub sampler: SettingSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResolvedDraft {
    pub positive: String,
    pub negative: String,
    pub fragments: Vec<ResolvedFragment>,
    pub settings: ResolvedSettings,
    pub provenance: SettingsProvenance,
    pub issues: Vec<ResolutionIssue>,
}

/// Storage failures preserve their original cause; editable dependency failures retain locations.
#[derive(Debug, thiserror::Error)]
pub enum ExpansionError {
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
    #[error("cannot expand resource: unresolved dependencies")]
    Unresolved { issues: Vec<ResolutionIssue> },
}

#[derive(Clone, Copy, Default)]
struct Context<'a> {
    instance_id: Option<&'a str>,
    resource: Option<&'a Resource>,
    expanded: bool,
}

fn issue(
    kind: ResolutionIssueKind,
    scope: Option<PromptScope>,
    node_id: Option<&str>,
    context: Context<'_>,
    resource_id: Option<&str>,
    message: String,
) -> ResolutionIssue {
    ResolutionIssue {
        kind,
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
            format!("Resource '{id}' was not found."),
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
            format!(
                "Resource '{id}' is not a {}.",
                if preset { "preset" } else { "chunk" }
            ),
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
                format!(
                    "Override target '{}' no longer exists in this preset.",
                    edit.node_id
                ),
            ));
        }
    }
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

fn overlay(
    target: &mut GenerationSettings,
    sources: &mut SettingsProvenance,
    values: &GenerationSettings,
    source: &SettingSource,
) {
    macro_rules! field {
        ($name:ident) => {
            if values.$name.is_some() {
                target.$name = values.$name;
                sources.$name = source.clone();
            }
        };
    }
    field!(model);
    field!(size);
    field!(steps);
    field!(scale);
    field!(sampler);
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
    let mut fragments = Vec::new();
    let mut issues = Vec::new();
    let mut settings = GenerationSettings::default();
    let mut provenance = SettingsProvenance::default();
    for instance in draft.presets.iter().filter(|instance| instance.enabled) {
        match &instance.binding {
            PresetBinding::Linked {
                resource_id,
                overrides,
            } => {
                let context = Context {
                    instance_id: Some(&instance.id),
                    ..Context::default()
                };
                let Some(resource) =
                    lookup(resource_id, true, None, None, context, reader, &mut issues)?
                else {
                    continue;
                };
                let ResourceContent::Preset {
                    composition,
                    defaults,
                } = &resource.content
                else {
                    unreachable!("lookup checks resource kind")
                };
                let context = Context {
                    resource: Some(&resource),
                    ..context
                };
                stale_overrides(composition, overrides, context, &mut issues);
                resolve_composition(
                    composition,
                    overrides,
                    context,
                    reader,
                    &mut fragments,
                    &mut issues,
                )?;
                overlay(
                    &mut settings,
                    &mut provenance,
                    defaults,
                    &SettingSource::Preset {
                        preset_instance_id: instance.id.clone(),
                        resource_id: Some(resource.id.clone()),
                        name: resource.name.clone(),
                        expanded: false,
                    },
                );
            },
            PresetBinding::Expanded {
                name,
                composition,
                defaults,
            } => {
                resolve_composition(
                    composition,
                    &[],
                    Context {
                        instance_id: Some(&instance.id),
                        expanded: true,
                        resource: None,
                    },
                    reader,
                    &mut fragments,
                    &mut issues,
                )?;
                overlay(
                    &mut settings,
                    &mut provenance,
                    defaults,
                    &SettingSource::Preset {
                        preset_instance_id: instance.id.clone(),
                        resource_id: None,
                        name: name.clone(),
                        expanded: true,
                    },
                );
            },
        }
    }
    resolve_composition(
        &draft.composition,
        &[],
        Context::default(),
        reader,
        &mut fragments,
        &mut issues,
    )?;
    overlay(
        &mut settings,
        &mut provenance,
        &draft.settings,
        &SettingSource::Draft,
    );
    Ok(finish_resolution(&settings, provenance, fragments, issues))
}

fn finish_resolution(
    settings: &GenerationSettings,
    provenance: SettingsProvenance,
    fragments: Vec<ResolvedFragment>,
    issues: Vec<ResolutionIssue>,
) -> ResolvedDraft {
    // Resolve the final model first: all unspecified parameters inherit that model's SDK defaults.
    let model = settings.model.unwrap_or_default();
    let defaults = model.descriptor().defaults();
    let settings = ResolvedSettings {
        model,
        size: settings.size.unwrap_or(defaults.size),
        steps: settings.steps.unwrap_or(defaults.sampling.steps),
        scale: settings.scale.unwrap_or(defaults.sampling.scale),
        sampler: settings.sampler.unwrap_or(defaults.sampling.sampler),
    };
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
    } = &resource.content
    else {
        unreachable!("lookup checks resource kind")
    };
    let context = Context {
        resource: Some(&resource),
        ..context
    };
    stale_overrides(composition, overrides, context, &mut issues);
    let mut expanded = Composition::default();
    for (scope, nodes, output) in [
        (
            PromptScope::Positive,
            &composition.positive,
            &mut expanded.positive,
        ),
        (
            PromptScope::Negative,
            &composition.negative,
            &mut expanded.negative,
        ),
    ] {
        for node in nodes {
            let (node, _) = apply_override(node, overrides);
            if let Some(node) = inline_node(&node, Some(scope), context, reader, &mut issues)? {
                output.push(node);
            }
        }
    }
    if !issues.is_empty() {
        return Err(ExpansionError::Unresolved { issues });
    }
    Ok(PresetInstance {
        id: instance.id.clone(),
        enabled: instance.enabled,
        binding: PresetBinding::Expanded {
            name: resource.name.clone(),
            composition: expanded,
            defaults: defaults.clone(),
        },
    })
}

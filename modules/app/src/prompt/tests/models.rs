use super::*;

const CHUNK: &str = "b3d3a957-ab5f-468a-b804-6f7184122b27";
const PRESET: &str = "a29c4eef-5294-4778-9bfa-b7e17a465fa6";

#[test]
fn final_model_checks_each_empty_chunk_usage_and_setting_only_preset() {
    let mut part = chunk(CHUNK, "");
    part.models = vec![Model::NaiDiffusion3.as_str().into()];
    let mut recipe = preset(
        PRESET,
        vec![chunk_node("nested", CHUNK)],
        vec![],
        GenerationSettings {
            model: Some(Model::NaiDiffusion3),
            ..GenerationSettings::default()
        },
    );
    recipe.models = part.models.clone();
    let draft = Draft {
        presets: vec![instance("preset-instance", PRESET, vec![])],
        composition: Composition {
            positive: vec![chunk_node("direct", CHUNK)],
            negative: vec![],
        },
        settings: GenerationSettings {
            model: Some(Model::NaiDiffusion45Full),
            ..GenerationSettings::default()
        },
        ..Draft::default()
    };
    let resolved = resolve_draft(&draft, &Resources::new(vec![part, recipe])).unwrap();
    assert_eq!(resolved.positive, "");
    assert_eq!(resolved.settings.model, Model::NaiDiffusion45Full);
    assert_eq!(resolved.issues.len(), 3);
    let preset = resolved
        .issues
        .iter()
        .find(|issue| issue.resource_id.as_deref() == Some(PRESET))
        .unwrap();
    assert_eq!(
        preset.preset_instance_id.as_deref(),
        Some("preset-instance")
    );
    let nested = resolved
        .issues
        .iter()
        .find(|issue| issue.node_id.as_deref() == Some("nested"))
        .unwrap();
    assert_eq!(
        nested.preset_instance_id.as_deref(),
        Some("preset-instance")
    );
    assert_eq!(nested.scope, Some(PromptScope::Positive));
    let direct = resolved
        .issues
        .iter()
        .find(|issue| issue.node_id.as_deref() == Some("direct"))
        .unwrap();
    assert_eq!(direct.preset_instance_id, None);
    assert!(
        resolved
            .issues
            .iter()
            .all(|issue| issue.kind == ResolutionIssueKind::ModelMismatch)
    );
}

#[test]
fn disabled_usages_do_not_constrain_models_and_instance_overrides_are_respected() {
    let mut part = chunk(CHUNK, "text");
    part.models = vec![Model::NaiDiffusion3.as_str().into()];
    let mut recipe = preset(
        PRESET,
        vec![chunk_node("nested", CHUNK)],
        vec![],
        GenerationSettings::default(),
    );
    recipe.models = part.models.clone();
    let mut disabled = instance("disabled", PRESET, vec![]);
    disabled.enabled = false;
    let mut node = chunk_node("disabled-node", CHUNK);
    if let PromptNode::Chunk { enabled, .. } = &mut node {
        *enabled = false;
    }
    let mut active = instance(
        "active",
        PRESET,
        vec![InstanceOverride {
            node_id: "nested".into(),
            enabled: Some(false),
            text: None,
        }],
    );
    // Remove the preset's own restriction to isolate the disabled nested chunk.
    recipe.models.clear();
    let draft = Draft {
        presets: vec![disabled, active.clone()],
        composition: Composition {
            positive: vec![node],
            negative: vec![],
        },
        settings: GenerationSettings {
            model: Some(Model::NaiDiffusion45Full),
            ..GenerationSettings::default()
        },
        ..Draft::default()
    };
    let resources = Resources::new(vec![part, recipe]);
    assert_eq!(resolve_draft(&draft, &resources).unwrap().issues, []);
    if let PresetBinding::Linked { overrides, .. } = &mut active.binding {
        overrides.clear();
    }
    let enabled = Draft {
        presets: vec![active],
        ..draft
    };
    let issues = resolve_draft(&enabled, &resources).unwrap().issues;
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].node_id.as_deref(), Some("nested"));
}

#[test]
fn resource_metadata_rejects_duplicate_tags_unknown_models_and_non_uuid_references() {
    let mut resource = chunk(CHUNK, "content");
    resource.tags = vec!["Tag".into(), "tag".into()];
    assert_eq!(validate_resource(&resource).unwrap_err().field, "tags");
    resource.tags.clear();
    resource.models = vec!["unknown".into()];
    assert_eq!(validate_resource(&resource).unwrap_err().field, "models");
    let invalid = preset(
        PRESET,
        vec![chunk_node("node", "invalid-id")],
        vec![],
        GenerationSettings::default(),
    );
    assert_eq!(
        validate_resource(&invalid).unwrap_err().field,
        "composition.node.resourceId"
    );
}

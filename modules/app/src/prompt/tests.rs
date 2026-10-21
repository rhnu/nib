use std::{cell::Cell, collections::HashMap};

use novelai_bridge::{ImageSize, Model, Sampler};

use super::*;
use crate::{
    persistence::PersistenceError,
    session::{Draft, validate_draft},
};

#[derive(Default)]
struct Resources {
    values: HashMap<String, Resource>,
    reads: Cell<usize>,
}

impl Resources {
    fn new(resources: Vec<Resource>) -> Self {
        Self {
            values: resources
                .into_iter()
                .map(|resource| (resource.id.clone(), resource))
                .collect(),
            reads: Cell::new(0),
        }
    }
}

impl ResourceReader for Resources {
    fn get_resource(&self, id: &str) -> Result<Option<Resource>, PersistenceError> {
        self.reads.set(self.reads.get() + 1);
        Ok(self.values.get(id).cloned())
    }
}

fn text(id: &str, value: &str) -> PromptNode {
    PromptNode::Text {
        id: id.into(),
        enabled: true,
        text: value.into(),
    }
}

fn chunk_node(id: &str, resource_id: &str) -> PromptNode {
    PromptNode::Chunk {
        id: id.into(),
        enabled: true,
        resource_id: resource_id.into(),
        override_text: None,
    }
}

fn chunk(id: &str, value: &str) -> Resource {
    Resource {
        id: id.into(),
        revision: 1,
        name: format!("Name {id}"),
        content: ResourceContent::Chunk { text: value.into() },
    }
}

fn preset(
    id: &str,
    positive: Vec<PromptNode>,
    negative: Vec<PromptNode>,
    defaults: GenerationSettings,
) -> Resource {
    Resource {
        id: id.into(),
        revision: 1,
        name: format!("Name {id}"),
        content: ResourceContent::Preset {
            composition: Composition { positive, negative },
            defaults,
        },
    }
}

fn instance(id: &str, resource_id: &str, overrides: Vec<InstanceOverride>) -> PresetInstance {
    PresetInstance {
        id: id.into(),
        enabled: true,
        binding: PresetBinding::Linked {
            resource_id: resource_id.into(),
            overrides,
        },
    }
}

#[test]
fn stable_resource_identity_survives_rename_and_reports_current_source() {
    let mut draft = Draft::new("Study");
    draft
        .composition
        .positive
        .push(chunk_node("entry", "chunk"));
    let mut resource = chunk("chunk", " {cat},  [soft light] ");
    resource.name = "Renamed light".into();
    let resources = Resources::new(vec![resource]);
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.positive, "{cat},  [soft light]");
    assert_eq!(result.fragments[0].node_id, "entry");
    assert_eq!(result.fragments[0].resource_id.as_deref(), Some("chunk"));
    assert_eq!(
        result.fragments[0].resource_name.as_deref(),
        Some("Renamed light")
    );
    assert_eq!(result, resolve_draft(&draft, &resources).unwrap());
}

#[test]
fn instance_edits_are_local_and_empty_text_suppresses_a_definition() {
    let definition = preset(
        "recipe",
        vec![text("base", "original"), chunk_node("linked", "chunk")],
        vec![],
        GenerationSettings::default(),
    );
    let resources = Resources::new(vec![definition.clone(), chunk("chunk", "shared")]);
    let mut draft = Draft::new("Study");
    draft.presets = vec![
        instance(
            "edited",
            "recipe",
            vec![
                InstanceOverride {
                    node_id: "base".into(),
                    enabled: None,
                    text: Some(String::new()),
                },
                InstanceOverride {
                    node_id: "linked".into(),
                    enabled: None,
                    text: Some("local".into()),
                },
            ],
        ),
        instance("original", "recipe", vec![]),
    ];
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.positive, "local\noriginal\nshared");
    assert!(result.fragments[0].overridden);
    assert_eq!(
        result.fragments[0].preset_instance_id.as_deref(),
        Some("edited")
    );
    assert_eq!(result.fragments[0].resource_id.as_deref(), Some("chunk"));
    assert_eq!(result.fragments[1].resource_id.as_deref(), Some("recipe"));
    assert_eq!(resources.values["recipe"], definition);
}

#[test]
fn both_scopes_follow_preset_order_then_draft_order() {
    let resources = Resources::new(vec![
        preset(
            "one",
            vec![text("p", "p1")],
            vec![text("n", "n1")],
            GenerationSettings::default(),
        ),
        preset(
            "two",
            vec![text("p", "p2")],
            vec![text("n", "n2")],
            GenerationSettings::default(),
        ),
    ]);
    let mut draft = Draft::new("Order");
    draft.presets = vec![
        instance("one-instance", "one", vec![]),
        instance("two-instance", "two", vec![]),
    ];
    draft.composition = Composition {
        positive: vec![text("local-p", "p3")],
        negative: vec![text("local-n", "n3")],
    };
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.positive, "p1\np2\np3");
    assert_eq!(result.negative, "n1\nn2\nn3");
    assert_eq!(
        result
            .fragments
            .iter()
            .filter(|fragment| fragment.scope == PromptScope::Negative)
            .map(|fragment| fragment.node_id.as_str())
            .collect::<Vec<_>>(),
        ["n", "n", "local-n"]
    );
}

#[test]
fn missing_and_wrong_kind_dependencies_preserve_other_content_and_locations() {
    let resources = Resources::new(vec![
        chunk("not-preset", "chunk"),
        preset(
            "recipe",
            vec![],
            vec![chunk_node("missing-entry", "missing")],
            GenerationSettings::default(),
        ),
    ]);
    let mut draft = Draft::new("Repair");
    draft.presets = vec![
        instance("wrong-kind", "not-preset", vec![]),
        instance("recipe-instance", "recipe", vec![]),
    ];
    draft.composition.positive = vec![text("intact", "keep"), chunk_node("wrong-chunk", "recipe")];
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.positive, "keep");
    assert_eq!(result.issues.len(), 3);
    assert_eq!(result.issues[0].kind, ResolutionIssueKind::TypeMismatch);
    assert_eq!(
        result.issues[0].preset_instance_id.as_deref(),
        Some("wrong-kind")
    );
    let missing = &result.issues[1];
    assert_eq!(missing.kind, ResolutionIssueKind::MissingResource);
    assert_eq!(missing.scope, Some(PromptScope::Negative));
    assert_eq!(missing.node_id.as_deref(), Some("missing-entry"));
    assert_eq!(missing.resource_id.as_deref(), Some("missing"));
    assert_eq!(
        missing.preset_instance_id.as_deref(),
        Some("recipe-instance")
    );
}

#[test]
fn disabled_references_do_not_read_or_report_missing_resources() {
    let mut draft = Draft::new("Disabled");
    let mut disabled_node = chunk_node("entry", "missing");
    if let PromptNode::Chunk { enabled, .. } = &mut disabled_node {
        *enabled = false;
    }
    draft.composition.positive.push(disabled_node);
    let mut disabled_instance = instance("instance", "missing-preset", vec![]);
    disabled_instance.enabled = false;
    draft.presets.push(disabled_instance);
    let resources = Resources::default();
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.issues, []);
    assert_eq!(result.positive, "");
    assert_eq!(resources.reads.get(), 0);
}

#[test]
fn disabled_instance_override_skips_a_missing_chunk() {
    let resources = Resources::new(vec![preset(
        "recipe",
        vec![chunk_node("entry", "missing")],
        vec![],
        GenerationSettings::default(),
    )]);
    let mut draft = Draft::new("Disabled edit");
    draft.presets.push(instance(
        "instance",
        "recipe",
        vec![InstanceOverride {
            node_id: "entry".into(),
            enabled: Some(false),
            text: None,
        }],
    ));
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.issues, []);
    assert_eq!(resources.reads.get(), 1);
}

#[test]
fn parameter_layers_keep_sparse_values_and_use_final_models_sdk_defaults() {
    let first = GenerationSettings {
        model: Some(Model::NaiDiffusion3),
        steps: Some(12),
        scale: Some(4.5),
        ..GenerationSettings::default()
    };
    let second = GenerationSettings {
        steps: Some(23),
        sampler: Some(Sampler::KEuler),
        ..GenerationSettings::default()
    };
    let resources = Resources::new(vec![
        preset("one", vec![], vec![], first),
        preset("two", vec![], vec![], second),
    ]);
    let mut draft = Draft::new("Settings");
    draft.presets = vec![
        instance("first", "one", vec![]),
        instance("second", "two", vec![]),
    ];
    draft.settings.model = Some(Model::NaiDiffusion45Full);
    draft.settings.steps = Some(31);
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.settings.model, Model::NaiDiffusion45Full);
    assert_eq!(
        result.settings.size,
        Model::NaiDiffusion45Full.descriptor().defaults().size
    );
    assert_eq!(result.settings.steps, 31);
    assert_eq!(result.settings.scale, 4.5);
    assert_eq!(result.settings.sampler, Sampler::KEuler);
    assert_eq!(result.provenance.model, SettingSource::Draft);
    assert_eq!(result.provenance.steps, SettingSource::Draft);
    assert_eq!(result.provenance.size, SettingSource::SdkDefault);
    assert!(
        matches!(&result.provenance.scale, SettingSource::Preset { preset_instance_id, .. } if preset_instance_id == "first")
    );
    assert!(
        matches!(&result.provenance.sampler, SettingSource::Preset { preset_instance_id, .. } if preset_instance_id == "second")
    );
}

#[test]
fn empty_draft_uses_sdk_default_model_and_all_its_defaults() {
    let result = resolve_draft(&Draft::new("Blank"), &Resources::default()).unwrap();
    let model = Model::default();
    let defaults = model.descriptor().defaults();
    assert_eq!(result.settings.model, model);
    assert_eq!(result.settings.size, defaults.size);
    assert_eq!(result.settings.steps, defaults.sampling.steps);
    assert_eq!(result.settings.scale, defaults.sampling.scale);
    assert_eq!(result.settings.sampler, defaults.sampling.sampler);
}

#[test]
fn expansion_keeps_text_settings_identity_and_group_but_detaches_all_dependencies() {
    let resources = Resources::new(vec![
        chunk("chunk", "shared"),
        preset(
            "recipe",
            vec![text("plain", " base "), chunk_node("linked", "chunk")],
            vec![text("negative", "blur")],
            GenerationSettings {
                size: Some(ImageSize::square()),
                ..GenerationSettings::default()
            },
        ),
    ]);
    let linked = instance(
        "instance",
        "recipe",
        vec![InstanceOverride {
            node_id: "linked".into(),
            enabled: None,
            text: Some(" local ".into()),
        }],
    );
    let mut draft = Draft::new("Expand");
    draft.presets.push(linked.clone());
    let before = resolve_draft(&draft, &resources).unwrap();
    let expanded = expand_preset(&linked, &resources).unwrap();
    assert_eq!(expanded.id, linked.id);
    assert_eq!(expanded.enabled, linked.enabled);
    let PresetBinding::Expanded {
        name,
        composition,
        defaults,
    } = &expanded.binding
    else {
        panic!("must detach recipe")
    };
    assert_eq!(name, "Name recipe");
    assert_eq!(defaults.size, Some(ImageSize::square()));
    assert!(
        composition
            .positive
            .iter()
            .chain(&composition.negative)
            .all(|node| matches!(node, PromptNode::Text { .. }))
    );
    draft.presets[0] = expanded;
    let after = resolve_draft(&draft, &Resources::default()).unwrap();
    assert_eq!(after.positive, before.positive);
    assert_eq!(after.negative, before.negative);
    assert_eq!(after.settings, before.settings);
    assert!(
        after
            .fragments
            .iter()
            .all(|fragment| fragment.expanded && fragment.resource_id.is_none())
    );
    assert_eq!(after.issues, []);
    assert!(matches!(linked.binding, PresetBinding::Linked { .. }));
}

#[test]
fn single_chunk_expansion_keeps_explicit_empty_override_and_enabled_state() {
    let node = PromptNode::Chunk {
        id: "stable".into(),
        enabled: false,
        resource_id: "chunk".into(),
        override_text: Some(String::new()),
    };
    let result = expand_chunk(&node, &Resources::new(vec![chunk("chunk", "original")])).unwrap();
    assert_eq!(
        result,
        PromptNode::Text {
            id: "stable".into(),
            enabled: false,
            text: String::new()
        }
    );
}

#[test]
fn empty_chunk_override_does_not_fall_back_to_shared_text() {
    let mut draft = Draft::new("Empty override");
    draft.composition.positive = vec![
        PromptNode::Chunk {
            id: "empty".into(),
            enabled: true,
            resource_id: "chunk".into(),
            override_text: Some(String::new()),
        },
        chunk_node("inherited", "chunk"),
    ];
    let result = resolve_draft(&draft, &Resources::new(vec![chunk("chunk", "shared")])).unwrap();
    assert_eq!(result.positive, "shared");
    assert_eq!(result.fragments.len(), 1);
    assert_eq!(result.fragments[0].node_id, "inherited");
}

#[test]
fn instance_can_enable_a_disabled_entry_without_changing_the_preset() {
    let disabled = PromptNode::Text {
        id: "entry".into(),
        enabled: false,
        text: "optional".into(),
    };
    let definition = preset(
        "recipe",
        vec![disabled],
        vec![],
        GenerationSettings::default(),
    );
    let resources = Resources::new(vec![definition.clone()]);
    let mut draft = Draft::new("Enable entry");
    draft.presets.push(instance(
        "instance",
        "recipe",
        vec![InstanceOverride {
            node_id: "entry".into(),
            enabled: Some(true),
            text: None,
        }],
    ));
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.positive, "optional");
    assert!(result.fragments[0].overridden);
    assert_eq!(resources.values["recipe"], definition);
}

#[test]
fn failed_expansion_reports_missing_disabled_dependency_without_mutation() {
    let disabled = PromptNode::Chunk {
        id: "disabled".into(),
        enabled: false,
        resource_id: "missing".into(),
        override_text: None,
    };
    let resources = Resources::new(vec![preset(
        "recipe",
        vec![text("present", "keep"), disabled],
        vec![],
        GenerationSettings::default(),
    )]);
    let linked = instance("instance", "recipe", vec![]);
    let original = linked.clone();
    let error = expand_preset(&linked, &resources).unwrap_err();
    let ExpansionError::Unresolved { issues } = error else {
        panic!("dependency error expected")
    };
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].resource_id.as_deref(), Some("missing"));
    assert_eq!(issues[0].node_id.as_deref(), Some("disabled"));
    assert_eq!(linked, original);
}

#[test]
fn stale_override_is_visible_and_blocks_lossy_expansion() {
    let resources = Resources::new(vec![preset(
        "recipe",
        vec![text("current", "keep")],
        vec![],
        GenerationSettings::default(),
    )]);
    let mut draft = Draft::new("Stale edit");
    draft.presets.push(instance(
        "instance",
        "recipe",
        vec![InstanceOverride {
            node_id: "removed".into(),
            enabled: None,
            text: Some("lost".into()),
        }],
    ));
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.positive, "keep");
    assert_eq!(result.issues[0].kind, ResolutionIssueKind::StaleOverride);
    assert_eq!(result.issues[0].node_id.as_deref(), Some("removed"));
    assert!(matches!(
        expand_preset(&draft.presets[0], &resources),
        Err(ExpansionError::Unresolved { .. })
    ));
}

#[test]
fn save_validation_rejects_ambiguous_identities_and_empty_names() {
    let resource = preset(
        "recipe",
        vec![text("duplicate", "positive")],
        vec![text("duplicate", "negative")],
        GenerationSettings::default(),
    );
    assert_eq!(
        validate_resource(&resource).unwrap_err().field,
        "composition.node.id"
    );
    let mut draft = Draft::new("   ");
    assert_eq!(validate_draft(&draft).unwrap_err().field, "name");
    draft.name = "Valid".into();
    draft.presets = vec![
        instance("same", "one", vec![]),
        instance("same", "two", vec![]),
    ];
    assert_eq!(validate_draft(&draft).unwrap_err().field, "presets.id");
}

#[test]
fn malformed_expanded_groups_and_duplicate_overrides_cannot_be_saved() {
    let mut draft = Draft::new("Invalid");
    draft.presets.push(PresetInstance {
        id: "instance".into(),
        enabled: true,
        binding: PresetBinding::Expanded {
            name: "Recipe".into(),
            composition: Composition {
                positive: vec![chunk_node("entry", "chunk")],
                negative: vec![],
            },
            defaults: GenerationSettings::default(),
        },
    });
    assert_eq!(validate_draft(&draft).unwrap_err().field, "composition");
    let edit = InstanceOverride {
        node_id: "entry".into(),
        enabled: Some(true),
        text: None,
    };
    draft.presets[0] = instance("instance", "recipe", vec![edit.clone(), edit]);
    assert_eq!(
        validate_draft(&draft).unwrap_err().field,
        "presets.overrides.nodeId"
    );
}

#[test]
fn wire_roundtrip_keeps_tagged_camel_case_and_empty_overrides() {
    let node = PromptNode::Chunk {
        id: "node".into(),
        enabled: true,
        resource_id: "resource".into(),
        override_text: Some(String::new()),
    };
    let value = serde_json::to_value(&node).unwrap();
    assert_eq!(value["kind"], "chunk");
    assert_eq!(value["resourceId"], "resource");
    assert_eq!(value["overrideText"], "");
    assert_eq!(serde_json::from_value::<PromptNode>(value).unwrap(), node);
}

#[test]
fn backend_failures_remain_errors_in_resolution_and_expansion() {
    struct Broken;
    impl ResourceReader for Broken {
        fn get_resource(&self, _id: &str) -> Result<Option<Resource>, PersistenceError> {
            Err(PersistenceError::Locked)
        }
    }
    let mut draft = Draft::new("Failure");
    draft
        .composition
        .positive
        .push(chunk_node("entry", "resource"));
    assert!(matches!(
        resolve_draft(&draft, &Broken),
        Err(PersistenceError::Locked)
    ));
    assert!(matches!(
        expand_chunk(&draft.composition.positive[0], &Broken),
        Err(ExpansionError::Persistence(PersistenceError::Locked))
    ));
}

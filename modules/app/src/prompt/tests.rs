use std::{cell::Cell, collections::HashMap};

use novelai_bridge::{ImageSize, Model, Sampler};

use super::*;
use crate::{
    persistence::PersistenceError,
    session::{Draft, ReferenceInputs, validate_draft},
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
        description: String::new(),
        aliases: Vec::new(),
        tags: Vec::new(),
        models: Vec::new(),
        folder_id: None,
        cover_asset_id: None,
        created_at: 0,
        updated_at: 0,
        id: id.into(),
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
        description: String::new(),
        aliases: Vec::new(),
        tags: Vec::new(),
        models: Vec::new(),
        folder_id: None,
        cover_asset_id: None,
        created_at: 0,
        updated_at: 0,
        id: id.into(),
        name: format!("Name {id}"),
        content: ResourceContent::Preset {
            composition: Composition { positive, negative },
            defaults,
            characters: Vec::new(),
            references: ReferenceInputs::default(),
        },
    }
}

fn instance(id: &str, resource_id: &str, overrides: Vec<InstanceOverride>) -> PresetInstance {
    PresetInstance {
        id: id.into(),
        enabled: true,
        binding: PresetBinding::Linked {
            resource_id: resource_id.into(),
            settings_overrides: crate::prompt::GenerationSettings::default(),
            overrides,
            output_overrides: PresetOutputOverrides::default(),
        },
    }
}

#[test]
fn stable_resource_identity_survives_rename_and_reports_current_source() {
    let mut draft = Draft::default();
    draft
        .composition
        .positive
        .push(chunk_node("entry", CHUNK_ID));
    let mut resource = chunk(CHUNK_ID, " {cat},  [soft light] ");
    resource.name = "Renamed light".into();
    let resources = Resources::new(vec![resource]);
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.positive, "{cat},  [soft light]");
    assert_eq!(result.fragments[0].node_id, "entry");
    assert_eq!(result.fragments[0].resource_id.as_deref(), Some(CHUNK_ID));
    assert_eq!(
        result.fragments[0].resource_name.as_deref(),
        Some("Renamed light")
    );
    assert_eq!(result, resolve_draft(&draft, &resources).unwrap());
}

#[test]
fn instance_edits_are_local_and_empty_text_suppresses_a_definition() {
    let definition = preset(
        RECIPE_ID,
        vec![text("base", "original"), chunk_node("linked", CHUNK_ID)],
        vec![],
        GenerationSettings::default(),
    );
    let resources = Resources::new(vec![definition.clone(), chunk(CHUNK_ID, "shared")]);
    let draft = Draft {
        presets: vec![
            instance(
                "edited",
                RECIPE_ID,
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
            instance("original", RECIPE_ID, vec![]),
        ],
        ..Draft::default()
    };
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.positive, "local\noriginal\nshared");
    assert!(result.fragments[0].overridden);
    assert_eq!(
        result.fragments[0].preset_instance_id.as_deref(),
        Some("edited")
    );
    assert_eq!(result.fragments[0].resource_id.as_deref(), Some(CHUNK_ID));
    assert_eq!(result.fragments[1].resource_id.as_deref(), Some(RECIPE_ID));
    assert_eq!(resources.values[RECIPE_ID], definition);
}

#[test]
fn both_scopes_follow_preset_order_then_draft_order() {
    let resources = Resources::new(vec![
        preset(
            ONE_ID,
            vec![text("p", "p1")],
            vec![text("n", "n1")],
            GenerationSettings::default(),
        ),
        preset(
            TWO_ID,
            vec![text("p", "p2")],
            vec![text("n", "n2")],
            GenerationSettings::default(),
        ),
    ]);
    let draft = Draft {
        presets: vec![
            instance("one-instance", ONE_ID, vec![]),
            instance("two-instance", TWO_ID, vec![]),
        ],
        composition: Composition {
            positive: vec![text("local-p", "p3")],
            negative: vec![text("local-n", "n3")],
        },
        ..Draft::default()
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
        chunk(NOT_PRESET_ID, "chunk"),
        preset(
            RECIPE_ID,
            vec![],
            vec![chunk_node("missing-entry", MISSING_ID)],
            GenerationSettings::default(),
        ),
    ]);
    let mut draft = Draft {
        presets: vec![
            instance("wrong-kind", NOT_PRESET_ID, vec![]),
            instance("recipe-instance", RECIPE_ID, vec![]),
        ],
        ..Draft::default()
    };
    draft.composition.positive = vec![text("intact", "keep"), chunk_node("wrong-chunk", RECIPE_ID)];
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
    assert_eq!(missing.resource_id.as_deref(), Some(MISSING_ID));
    assert_eq!(
        missing.preset_instance_id.as_deref(),
        Some("recipe-instance")
    );
}

#[test]
fn disabled_references_do_not_read_or_report_missing_resources() {
    let mut draft = Draft::default();
    let mut disabled_node = chunk_node("entry", MISSING_ID);
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
        RECIPE_ID,
        vec![chunk_node("entry", MISSING_ID)],
        vec![],
        GenerationSettings::default(),
    )]);
    let mut draft = Draft::default();
    draft.presets.push(instance(
        "instance",
        RECIPE_ID,
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
        preset(ONE_ID, vec![], vec![], first),
        preset(TWO_ID, vec![], vec![], second),
    ]);
    let mut draft = Draft {
        presets: vec![
            instance(FIRST_ID, ONE_ID, vec![]),
            instance(SECOND_ID, TWO_ID, vec![]),
        ],
        ..Draft::default()
    };
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
        matches!(&result.provenance.scale, SettingSource::Preset { preset_instance_id, .. } if preset_instance_id == FIRST_ID)
    );
    assert!(
        matches!(&result.provenance.sampler, SettingSource::Preset { preset_instance_id, .. } if preset_instance_id == SECOND_ID)
    );
}

#[test]
fn empty_draft_uses_sdk_default_model_and_all_its_defaults() {
    let result = resolve_draft(&Draft::default(), &Resources::default()).unwrap();
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
        chunk(CHUNK_ID, "shared"),
        preset(
            RECIPE_ID,
            vec![text("plain", " base "), chunk_node("linked", CHUNK_ID)],
            vec![text("negative", "blur")],
            GenerationSettings {
                size: Some(ImageSize::square()),
                ..GenerationSettings::default()
            },
        ),
    ]);
    let linked = instance(
        "instance",
        RECIPE_ID,
        vec![InstanceOverride {
            node_id: "linked".into(),
            enabled: None,
            text: Some(" local ".into()),
        }],
    );
    let mut draft = Draft::default();
    draft.presets.push(linked.clone());
    let before = resolve_draft(&draft, &resources).unwrap();
    let expanded = expand_preset(&linked, &resources).unwrap();
    assert_eq!(expanded.id, linked.id);
    assert_eq!(expanded.enabled, linked.enabled);
    let PresetBinding::Expanded {
        name,
        composition,
        defaults,
        ..
    } = &expanded.binding
    else {
        panic!("must detach recipe")
    };
    assert_eq!(name, "Name bf4d3461-5ac4-5380-81c8-bf6a9629afb8");
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
        resource_id: CHUNK_ID.into(),
        override_text: Some(String::new()),
    };
    let result = expand_chunk(&node, &Resources::new(vec![chunk(CHUNK_ID, "original")])).unwrap();
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
    let mut draft = Draft::default();
    draft.composition.positive = vec![
        PromptNode::Chunk {
            id: "empty".into(),
            enabled: true,
            resource_id: CHUNK_ID.into(),
            override_text: Some(String::new()),
        },
        chunk_node("inherited", CHUNK_ID),
    ];
    let result = resolve_draft(&draft, &Resources::new(vec![chunk(CHUNK_ID, "shared")])).unwrap();
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
        RECIPE_ID,
        vec![disabled],
        vec![],
        GenerationSettings::default(),
    );
    let resources = Resources::new(vec![definition.clone()]);
    let mut draft = Draft::default();
    draft.presets.push(instance(
        "instance",
        RECIPE_ID,
        vec![InstanceOverride {
            node_id: "entry".into(),
            enabled: Some(true),
            text: None,
        }],
    ));
    let result = resolve_draft(&draft, &resources).unwrap();
    assert_eq!(result.positive, "optional");
    assert!(result.fragments[0].overridden);
    assert_eq!(resources.values[RECIPE_ID], definition);
}

#[test]
fn failed_expansion_reports_missing_disabled_dependency_without_mutation() {
    let disabled = PromptNode::Chunk {
        id: "disabled".into(),
        enabled: false,
        resource_id: MISSING_ID.into(),
        override_text: None,
    };
    let resources = Resources::new(vec![preset(
        RECIPE_ID,
        vec![text("present", "keep"), disabled],
        vec![],
        GenerationSettings::default(),
    )]);
    let linked = instance("instance", RECIPE_ID, vec![]);
    let original = linked.clone();
    let error = expand_preset(&linked, &resources).unwrap_err();
    let ExpansionError::Unresolved { issues } = error else {
        panic!("dependency error expected")
    };
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].resource_id.as_deref(), Some(MISSING_ID));
    assert_eq!(issues[0].node_id.as_deref(), Some("disabled"));
    assert_eq!(linked, original);
}

#[test]
fn stale_override_is_visible_and_blocks_lossy_expansion() {
    let resources = Resources::new(vec![preset(
        RECIPE_ID,
        vec![text("current", "keep")],
        vec![],
        GenerationSettings::default(),
    )]);
    let mut draft = Draft::default();
    draft.presets.push(instance(
        "instance",
        RECIPE_ID,
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

mod outputs;
mod source;

#[test]
fn sparse_instance_settings_preserve_false_zero_inheritance_and_detachment() {
    let resources = Resources::new(vec![preset(
        RECIPE_ID,
        vec![text("base", "cat")],
        vec![],
        GenerationSettings {
            seed: Some(99),
            furry_mode: Some(true),
            steps: Some(20),
            ..GenerationSettings::default()
        },
    )]);
    let mut linked = instance("instance", RECIPE_ID, vec![]);
    let PresetBinding::Linked {
        settings_overrides, ..
    } = &mut linked.binding
    else {
        unreachable!()
    };
    *settings_overrides = GenerationSettings {
        seed: Some(0),
        furry_mode: Some(false),
        ..GenerationSettings::default()
    };
    let draft = Draft {
        presets: vec![linked.clone()],
        ..Draft::default()
    };
    let value = serde_json::to_value(&draft).unwrap();
    let reopened: Draft = serde_json::from_value(value).unwrap();
    let resolved = resolve_draft(&reopened, &resources).unwrap();
    assert_eq!(resolved.settings.seed, 0);
    assert!(!resolved.settings.furry_mode);
    assert_eq!(resolved.settings.steps, 20);
    assert!(
        matches!(&resolved.provenance.seed, SettingSource::PresetOverride { instance_id, resource_id } if instance_id == "instance" && resource_id == RECIPE_ID)
    );
    let expanded = expand_preset(&linked, &resources).unwrap();
    let expanded_resolved = resolve_draft(
        &Draft {
            presets: vec![expanded],
            ..Draft::default()
        },
        &Resources::default(),
    )
    .unwrap();
    assert_eq!(expanded_resolved.settings, resolved.settings);
    let mut inherited = reopened;
    let PresetBinding::Linked {
        settings_overrides, ..
    } = &mut inherited.presets[0].binding
    else {
        unreachable!()
    };
    settings_overrides.seed = None;
    settings_overrides.furry_mode = None;
    let inherited = resolve_draft(&inherited, &resources).unwrap();
    assert_eq!(inherited.settings.seed, 99);
    assert!(inherited.settings.furry_mode);
    assert!(matches!(
        inherited.provenance.seed,
        SettingSource::Preset { .. }
    ));
}

mod models;

mod validation;

const CHUNK_ID: &str = "f09e3fea-eb8d-51bb-b867-db7c7266f7ae";
const FIRST_ID: &str = "1918230f-f304-5226-a9e9-df18020e6c91";
const MISSING_ID: &str = "f81d93ad-3c35-5062-8c67-6ff06539f46f";
const NOT_PRESET_ID: &str = "13d34d19-201f-50b5-8262-f248e13b7dee";
const ONE_ID: &str = "ed0d0d65-5e87-5bb5-965c-b7b45908ac8a";
const RECIPE_ID: &str = "bf4d3461-5ac4-5380-81c8-bf6a9629afb8";
const RESOURCE_ID: &str = "7710f62a-ebef-5954-b5ab-d4f94975a1c8";
const SECOND_ID: &str = "0e7b4c73-bfa2-58c6-9015-e840f2634f66";
const SHARED_ID: &str = "12daa933-e0e5-52c8-8996-565f56f2e553";
const TWO_ID: &str = "8ba3a83e-d3aa-5817-90e0-9b67a9097615";
const UNUSED_ID: &str = "163aea03-1057-5533-8155-cf8987d73a94";

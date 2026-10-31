use serde_json::json;

use super::*;
use crate::prompt::{PresetInstance, PresetOutputOverrides, Resource};

#[derive(Default)]
struct Resources(Vec<Resource>);

impl ResourceReader for Resources {
    fn get_resource(
        &self,
        id: &str,
    ) -> Result<Option<Resource>, crate::persistence::PersistenceError> {
        Ok(self.0.iter().find(|resource| resource.id == id).cloned())
    }
}

fn text(id: &str, text: &str) -> PromptNode {
    PromptNode::Text {
        id: id.into(),
        enabled: true,
        text: text.into(),
    }
}

fn definition() -> Resource {
    Resource {
        id: "recipe".into(),
        name: "Recipe".into(),
        description: String::new(),
        aliases: vec![],
        tags: vec![],
        models: vec![],
        folder_id: None,
        cover_asset_id: None,
        created_at: 0,
        updated_at: 0,
        content: ResourceContent::Preset {
            composition: Composition {
                positive: vec![text("node", "original")],
                negative: vec![],
            },
            defaults: GenerationSettings::default(),
            characters: vec![],
            references: ReferenceInputs::default(),
        },
    }
}

fn instance(id: &str, enabled: bool) -> PresetInstance {
    PresetInstance {
        id: id.into(),
        enabled,
        binding: PresetBinding::Linked {
            resource_id: "recipe".into(),
            overrides: vec![],
            settings_overrides: GenerationSettings::default(),
            output_overrides: PresetOutputOverrides::default(),
        },
    }
}

#[test]
fn settings_patch_preserves_omissions_false_and_zero_and_clears_inheritance() {
    let mut settings = GenerationSettings {
        seed: Some(9),
        steps: Some(28),
        smea: Some(true),
        scale: Some(5.0),
        ..Default::default()
    };
    let changes = serde_json::from_value(json!({"seed":0,"smea":false,"scale":null})).unwrap();
    patch_settings(&mut settings, changes).unwrap();
    assert_eq!(settings.seed, Some(0));
    assert_eq!(settings.smea, Some(false));
    assert_eq!(settings.scale, None);
    assert_eq!(settings.steps, Some(28));
    assert!(
        patch_settings(
            &mut settings,
            serde_json::from_value(json!({"credentials.secret":"bad"})).unwrap()
        )
        .is_err()
    );
}

#[test]
fn linked_node_edit_changes_only_the_selected_instance() {
    let resources = Resources(vec![definition()]);
    let mut draft = Draft {
        presets: vec![instance("first", true), instance("second", true)],
        ..Default::default()
    };
    let edit = NodeEdit {
        instance_id: Some("second".into()),
        character_id: None,
        node_id: "node".into(),
        text: Some("changed".into()),
        enabled: Some(false),
    };
    edit_node(&mut draft, &edit, &resources).unwrap();
    let PresetBinding::Linked {
        overrides: first, ..
    } = &draft.presets[0].binding
    else {
        panic!("linked")
    };
    let PresetBinding::Linked {
        overrides: second, ..
    } = &draft.presets[1].binding
    else {
        panic!("linked")
    };
    assert_eq!(first.len(), 0);
    assert_eq!(second[0].text.as_deref(), Some("changed"));
    assert_eq!(second[0].enabled, Some(false));
    let ResourceContent::Preset { composition, .. } = &resources.0[0].content else {
        panic!("preset")
    };
    assert_eq!(composition.positive[0], text("node", "original"));
}

#[test]
fn preset_save_expands_all_layers_and_retains_disabled_materials() {
    let resources = Resources(vec![definition()]);
    let draft = Draft {
        presets: vec![instance("on", true), instance("off", false)],
        composition: Composition {
            positive: vec![text("direct", "local")],
            negative: vec![],
        },
        ..Default::default()
    };
    let ResourceContent::Preset { composition, .. } = preset_content(&draft, &resources).unwrap()
    else {
        panic!("preset")
    };
    assert_eq!(composition.positive.len(), 3);
    assert!(composition.positive[0].enabled());
    assert!(!composition.positive[1].enabled());
    assert!(composition.positive[2].enabled());
    let texts: Vec<_> = composition
        .positive
        .iter()
        .map(|node| match node {
            PromptNode::Text { text, .. } => text.as_str(),
            PromptNode::Chunk { .. } => panic!("saved preset must be self-contained"),
        })
        .collect();
    assert_eq!(texts, ["original", "original", "local"]);
}

#[test]
fn wrong_character_scope_does_not_edit_a_base_node() {
    let mut draft = Draft {
        composition: Composition {
            positive: vec![text("node", "original")],
            negative: vec![],
        },
        ..Default::default()
    };
    let edit = NodeEdit {
        instance_id: None,
        character_id: Some("missing".into()),
        node_id: "node".into(),
        text: Some("wrong".into()),
        enabled: None,
    };
    assert!(edit_node(&mut draft, &edit, &Resources::default()).is_err());
    assert_eq!(draft.composition.positive[0], text("node", "original"));
}

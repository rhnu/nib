use std::{cell::RefCell, collections::HashMap, io};

use super::*;
use crate::prompt::{
    CharacterComposition, GenerationSettings, PresetInstance, PresetOutputOverrides,
};

#[derive(Default)]
struct Resources {
    values: HashMap<String, Resource>,
    reads: RefCell<Vec<String>>,
    denied: Option<String>,
}

impl ResourceReader for Resources {
    fn get_resource(&self, id: &str) -> Result<Option<Resource>, PersistenceError> {
        self.reads.borrow_mut().push(id.to_owned());
        if self.denied.as_deref() == Some(id) {
            return Err(PersistenceError::failure(
                "read resource",
                io::Error::from(io::ErrorKind::PermissionDenied),
            ));
        }
        Ok(self.values.get(id).cloned())
    }
}

fn reference(id: &str, resource_id: &str) -> PromptNode {
    PromptNode::Chunk {
        id: id.into(),
        enabled: false,
        resource_id: resource_id.into(),
        override_text: None,
    }
}

fn character(resource_id: &str) -> CharacterComposition {
    CharacterComposition {
        id: "character".into(),
        enabled: false,
        position: novelai_bridge::CharacterPosition::default(),
        composition: Composition {
            positive: vec![reference("character-node", resource_id)],
            negative: Vec::new(),
        },
    }
}

fn resource(id: &str, content: ResourceContent) -> Resource {
    Resource {
        id: id.into(),
        revision: 1,
        name: id.into(),
        content,
    }
}

#[test]
fn batch_reads_include_disabled_outputs_and_visit_repeated_or_missing_ids_once() {
    let recipe = resource(
        "recipe",
        ResourceContent::Preset {
            composition: Composition {
                positive: vec![reference("base", "shared"), reference("absent", "missing")],
                negative: vec![reference("duplicate", "shared")],
            },
            defaults: GenerationSettings::default(),
            characters: vec![character("role")],
            references: crate::session::ReferenceInputs::default(),
        },
    );
    let shared = resource(
        "shared",
        ResourceContent::Chunk {
            text: "base text".into(),
        },
    );
    let role = resource(
        "role",
        ResourceContent::Chunk {
            text: "role text".into(),
        },
    );
    let reader = Resources {
        values: [recipe, shared, role]
            .into_iter()
            .map(|value| (value.id.clone(), value))
            .collect(),
        ..Resources::default()
    };
    let definitions = resource_definitions(
        &["recipe".into(), "recipe".into(), "missing".into()],
        &reader,
    )
    .unwrap();
    let ids: HashSet<_> = definitions.iter().map(|value| value.id.as_str()).collect();
    assert_eq!(ids, HashSet::from(["recipe", "shared", "role"]));
    for id in ["recipe", "shared", "role", "missing"] {
        assert_eq!(
            reader
                .reads
                .borrow()
                .iter()
                .filter(|read| *read == id)
                .count(),
            1
        );
    }
}

#[test]
fn dependency_failures_preserve_the_backend_cause_instead_of_returning_a_partial_batch() {
    let recipe = resource(
        "recipe",
        ResourceContent::Preset {
            composition: Composition {
                positive: vec![reference("denied-node", "denied")],
                negative: Vec::new(),
            },
            defaults: GenerationSettings::default(),
            characters: Vec::new(),
            references: crate::session::ReferenceInputs::default(),
        },
    );
    let reader = Resources {
        values: HashMap::from([(recipe.id.clone(), recipe)]),
        denied: Some("denied".into()),
        ..Resources::default()
    };
    let error = resource_definitions(&["recipe".into()], &reader).unwrap_err();
    let PersistenceError::Failure { source, .. } = error else {
        panic!("a read failure must retain its backend error")
    };
    assert_eq!(
        source.downcast_ref::<io::Error>().unwrap().kind(),
        io::ErrorKind::PermissionDenied
    );
}

#[test]
fn draft_roots_include_disabled_instances_characters_and_expanded_outputs() {
    let draft = Draft {
        composition: Composition {
            positive: vec![reference("base", "direct")],
            negative: Vec::new(),
        },
        characters: vec![character("direct-role")],
        presets: vec![
            PresetInstance {
                id: "linked".into(),
                enabled: false,
                binding: PresetBinding::Linked {
                    resource_id: "recipe".into(),
                    overrides: Vec::new(),
                    settings_overrides: GenerationSettings::default(),
                    output_overrides: PresetOutputOverrides::default(),
                },
            },
            PresetInstance {
                id: "expanded".into(),
                enabled: false,
                binding: PresetBinding::Expanded {
                    name: "Detached".into(),
                    composition: Composition {
                        positive: Vec::new(),
                        negative: vec![reference("expanded-node", "expanded-source")],
                    },
                    defaults: GenerationSettings::default(),
                    characters: vec![character("expanded-role")],
                    references: crate::session::ReferenceInputs::default(),
                },
            },
        ],
        ..Draft::default()
    };
    assert_eq!(
        draft_resource_ids(&draft)
            .into_iter()
            .collect::<HashSet<_>>(),
        HashSet::from([
            "direct".into(),
            "direct-role".into(),
            "recipe".into(),
            "expanded-source".into(),
            "expanded-role".into(),
        ])
    );
}

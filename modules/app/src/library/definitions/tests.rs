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
        description: String::new(),
        aliases: Vec::new(),
        tags: Vec::new(),
        models: Vec::new(),
        folder_id: None,
        cover_asset_id: None,
        created_at: 0,
        updated_at: 0,
        id: id.into(),
        name: id.into(),
        content,
    }
}

#[test]
fn batch_reads_include_disabled_outputs_and_visit_repeated_or_missing_ids_once() {
    let recipe = resource(
        RECIPE_ID,
        ResourceContent::Preset {
            composition: Composition {
                positive: vec![
                    reference("base", SHARED_ID),
                    reference(ABSENT_ID, MISSING_ID),
                ],
                negative: vec![reference("duplicate", SHARED_ID)],
            },
            defaults: GenerationSettings::default(),
            characters: vec![character(ROLE_ID)],
            references: crate::session::ReferenceInputs::default(),
        },
    );
    let shared = resource(
        SHARED_ID,
        ResourceContent::Chunk {
            text: "base text".into(),
        },
    );
    let role = resource(
        ROLE_ID,
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
        &[RECIPE_ID.into(), RECIPE_ID.into(), MISSING_ID.into()],
        &reader,
    )
    .unwrap();
    let ids: HashSet<_> = definitions.iter().map(|value| value.id.as_str()).collect();
    assert_eq!(ids, HashSet::from([RECIPE_ID, SHARED_ID, ROLE_ID]));
    for id in [RECIPE_ID, SHARED_ID, ROLE_ID, MISSING_ID] {
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
        RECIPE_ID,
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
    let error = resource_definitions(&[RECIPE_ID.into()], &reader).unwrap_err();
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
                    resource_id: RECIPE_ID.into(),
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
            RECIPE_ID.into(),
            "expanded-source".into(),
            "expanded-role".into(),
        ])
    );
}

const ABSENT_ID: &str = "fb3a7893-4671-5a1f-a1a1-13bf8d7a3383";
const MISSING_ID: &str = "f81d93ad-3c35-5062-8c67-6ff06539f46f";
const RECIPE_ID: &str = "bf4d3461-5ac4-5380-81c8-bf6a9629afb8";
const ROLE_ID: &str = "d03ded75-edab-5ae5-896f-4033cd8d20b3";
const SHARED_ID: &str = "12daa933-e0e5-52c8-8996-565f56f2e553";

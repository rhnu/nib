use std::cell::Cell;

use super::*;
use crate::{
    prompt::{
        Composition, GenerationSettings, PresetBinding, PresetInstance, PresetOutputOverrides,
        PromptNode, ResourceContent, resolve_draft,
    },
    session::Draft,
};

struct CachedResources {
    values: HashMap<String, Resource>,
    cache: ResourceCache,
    reads: Cell<usize>,
}

impl ResourceReader for CachedResources {
    fn get_resource(&self, id: &str) -> Result<Option<Resource>, PersistenceError> {
        cached_resource(&self.cache, id, || {
            self.reads.set(self.reads.get() + 1);
            Ok(self.values.get(id).cloned())
        })
    }
}

fn references(resource_id: &str) -> Draft {
    let node = |id: &str| PromptNode::Chunk {
        id: id.into(),
        enabled: true,
        resource_id: resource_id.into(),
        override_text: None,
    };
    Draft {
        composition: Composition {
            positive: vec![node(FIRST_ID)],
            negative: vec![node(SECOND_ID)],
        },
        ..Draft::default()
    }
}

#[test]
fn repeated_reads_reuse_the_definition_without_sharing_mutable_results() {
    let resource = Resource {
        description: String::new(),
        aliases: Vec::new(),
        tags: Vec::new(),
        models: Vec::new(),
        folder_id: None,
        cover_asset_id: None,
        created_at: 0,
        updated_at: 0,
        id: CHUNK_ID.into(),
        name: "Original".into(),
        content: ResourceContent::Chunk { text: "cat".into() },
    };
    let reader = CachedResources {
        values: HashMap::from([(resource.id.clone(), resource)]),
        cache: RefCell::default(),
        reads: Cell::new(0),
    };
    let resolved = resolve_draft(&references(CHUNK_ID), &reader).unwrap();
    assert_eq!(resolved.positive, "cat");
    assert_eq!(resolved.negative, "cat");
    assert_eq!(reader.reads.get(), 1);

    let mut edited = reader.get_resource(CHUNK_ID).unwrap().unwrap();
    edited.name = "Local edit".into();
    assert_eq!(
        reader.get_resource(CHUNK_ID).unwrap().unwrap().name,
        "Original"
    );
    assert_eq!(reader.reads.get(), 1);

    // A new resource snapshot must observe later definitions instead of the prior cache.
    let next = CachedResources {
        values: HashMap::from([(edited.id.clone(), edited)]),
        cache: RefCell::default(),
        reads: Cell::new(0),
    };
    assert_eq!(
        next.get_resource(CHUNK_ID).unwrap().unwrap().name,
        "Local edit"
    );
    assert_eq!(next.reads.get(), 1);
}

#[test]
fn cached_absence_still_reports_every_affected_instance() {
    let recipe = Resource {
        description: String::new(),
        aliases: Vec::new(),
        tags: Vec::new(),
        models: Vec::new(),
        folder_id: None,
        cover_asset_id: None,
        created_at: 0,
        updated_at: 0,
        id: RECIPE_ID.into(),
        name: "Recipe".into(),
        content: ResourceContent::Preset {
            composition: references(MISSING_ID).composition,
            defaults: GenerationSettings::default(),
            characters: Vec::new(),
            references: crate::session::ReferenceInputs::default(),
        },
    };
    let reader = CachedResources {
        values: HashMap::from([(recipe.id.clone(), recipe)]),
        cache: RefCell::default(),
        reads: Cell::new(0),
    };
    let draft = Draft {
        presets: ["first-instance", "second-instance"]
            .into_iter()
            .map(|id| PresetInstance {
                id: id.into(),
                enabled: true,
                binding: PresetBinding::Linked {
                    resource_id: RECIPE_ID.into(),
                    overrides: Vec::new(),
                    settings_overrides: GenerationSettings::default(),
                    output_overrides: PresetOutputOverrides::default(),
                },
            })
            .collect(),
        ..Draft::default()
    };
    let resolved = resolve_draft(&draft, &reader).unwrap();
    assert_eq!(reader.reads.get(), 2);
    assert_eq!(resolved.issues.len(), 4);
    assert_eq!(resolved.issues[0].node_id.as_deref(), Some(FIRST_ID));
    assert_eq!(resolved.issues[1].node_id.as_deref(), Some(SECOND_ID));
    assert_eq!(resolved.issues[2].node_id.as_deref(), Some(FIRST_ID));
    assert_eq!(resolved.issues[3].node_id.as_deref(), Some(SECOND_ID));
    assert_eq!(
        resolved.issues[0].preset_instance_id.as_deref(),
        Some("first-instance")
    );
    assert_eq!(
        resolved.issues[2].preset_instance_id.as_deref(),
        Some("second-instance")
    );
}

#[test]
fn failed_reads_are_not_replaced_by_cached_absence() {
    let cache = ResourceCache::default();
    assert!(matches!(
        cached_resource(&cache, RESOURCE_ID, || Err(PersistenceError::Locked)),
        Err(PersistenceError::Locked)
    ));
    let retried = Cell::new(false);
    assert_eq!(
        cached_resource(&cache, RESOURCE_ID, || {
            retried.set(true);
            Ok(None)
        })
        .unwrap(),
        None
    );
    assert!(retried.get());
}

const CHUNK_ID: &str = "f09e3fea-eb8d-51bb-b867-db7c7266f7ae";
const FIRST_ID: &str = "1918230f-f304-5226-a9e9-df18020e6c91";
const MISSING_ID: &str = "f81d93ad-3c35-5062-8c67-6ff06539f46f";
const RECIPE_ID: &str = "bf4d3461-5ac4-5380-81c8-bf6a9629afb8";
const RESOURCE_ID: &str = "7710f62a-ebef-5954-b5ab-d4f94975a1c8";
const SECOND_ID: &str = "0e7b4c73-bfa2-58c6-9015-e840f2634f66";

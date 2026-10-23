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
            positive: vec![node("first")],
            negative: vec![node("second")],
        },
        ..Draft::default()
    }
}

#[test]
fn repeated_reads_reuse_the_definition_without_sharing_mutable_results() {
    let resource = Resource {
        id: "chunk".into(),
        revision: 1,
        name: "Original".into(),
        content: ResourceContent::Chunk { text: "cat".into() },
    };
    let reader = CachedResources {
        values: HashMap::from([(resource.id.clone(), resource)]),
        cache: RefCell::default(),
        reads: Cell::new(0),
    };
    let resolved = resolve_draft(&references("chunk"), &reader).unwrap();
    assert_eq!(resolved.positive, "cat");
    assert_eq!(resolved.negative, "cat");
    assert_eq!(reader.reads.get(), 1);

    let mut edited = reader.get_resource("chunk").unwrap().unwrap();
    edited.name = "Local edit".into();
    assert_eq!(
        reader.get_resource("chunk").unwrap().unwrap().name,
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
        next.get_resource("chunk").unwrap().unwrap().name,
        "Local edit"
    );
    assert_eq!(next.reads.get(), 1);
}

#[test]
fn cached_absence_still_reports_every_affected_instance() {
    let recipe = Resource {
        id: "recipe".into(),
        revision: 1,
        name: "Recipe".into(),
        content: ResourceContent::Preset {
            composition: references("missing").composition,
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
                    resource_id: "recipe".into(),
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
    assert_eq!(resolved.issues[0].node_id.as_deref(), Some("first"));
    assert_eq!(resolved.issues[1].node_id.as_deref(), Some("second"));
    assert_eq!(resolved.issues[2].node_id.as_deref(), Some("first"));
    assert_eq!(resolved.issues[3].node_id.as_deref(), Some("second"));
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
        cached_resource(&cache, "resource", || Err(PersistenceError::Locked)),
        Err(PersistenceError::Locked)
    ));
    let retried = Cell::new(false);
    assert_eq!(
        cached_resource(&cache, "resource", || {
            retried.set(true);
            Ok(None)
        })
        .unwrap(),
        None
    );
    assert!(retried.get());
}

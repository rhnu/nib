use super::*;

#[test]
fn save_validation_rejects_ambiguous_identities() {
    let resource = preset(
        RECIPE_ID,
        vec![text("duplicate", "positive")],
        vec![text("duplicate", "negative")],
        GenerationSettings::default(),
    );
    assert_eq!(
        validate_resource(&resource).unwrap_err().field,
        "composition.node.id"
    );
    let draft = Draft {
        presets: vec![
            instance("same", ONE_ID, vec![]),
            instance("same", TWO_ID, vec![]),
        ],
        ..Draft::default()
    };
    assert_eq!(validate_draft(&draft).unwrap_err().field, "presets.id");
}

#[test]
fn malformed_expanded_groups_and_duplicate_overrides_cannot_be_saved() {
    let mut draft = Draft::default();
    draft.presets.push(PresetInstance {
        id: "instance".into(),
        enabled: true,
        binding: PresetBinding::Expanded {
            name: "Recipe".into(),
            composition: Composition {
                positive: vec![chunk_node("entry", CHUNK_ID)],
                negative: vec![],
            },
            defaults: GenerationSettings::default(),
            characters: Vec::new(),
            references: ReferenceInputs::default(),
        },
    });
    assert_eq!(validate_draft(&draft).unwrap_err().field, "composition");
    let edit = InstanceOverride {
        node_id: "entry".into(),
        enabled: Some(true),
        text: None,
    };
    draft.presets[0] = instance("instance", RECIPE_ID, vec![edit.clone(), edit]);
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
        resource_id: RESOURCE_ID.into(),
        override_text: Some(String::new()),
    };
    let value = serde_json::to_value(&node).unwrap();
    assert_eq!(value["kind"], "chunk");
    assert_eq!(value["resourceId"], RESOURCE_ID);
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
    let mut draft = Draft::default();
    draft
        .composition
        .positive
        .push(chunk_node("entry", RESOURCE_ID));
    assert!(matches!(
        resolve_draft(&draft, &Broken),
        Err(PersistenceError::Locked)
    ));
    assert!(matches!(
        expand_chunk(&draft.composition.positive[0], &Broken),
        Err(ExpansionError::Persistence(PersistenceError::Locked))
    ));
}

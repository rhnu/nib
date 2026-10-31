use super::*;

fn folder(id: &str, parent: Option<&str>) -> ResourceFolder {
    ResourceFolder {
        id: id.into(),
        name: id.into(),
        parent_id: parent.map(str::to_owned),
        created_at: 0,
        updated_at: 0,
    }
}

#[test]
fn folder_moves_reject_self_and_descendant_destinations_but_allow_siblings() {
    let folders = vec![
        folder(PARENT_ID, None),
        folder(CHILD_ID, Some(PARENT_ID)),
        folder(OTHER_ID, None),
    ];
    assert!(validate_parent(PARENT_ID, Some(PARENT_ID), &folders).is_err());
    assert!(validate_parent(PARENT_ID, Some(CHILD_ID), &folders).is_err());
    assert!(validate_parent(CHILD_ID, Some(OTHER_ID), &folders).is_ok());
    assert!(validate_parent(CHILD_ID, None, &folders).is_ok());
}

#[test]
fn folder_creation_allows_eight_levels_but_rejects_a_ninth() {
    let ids: Vec<_> = (1..=9)
        .map(|id| uuid::Uuid::from_u128(id).to_string())
        .collect();
    let folders: Vec<_> = ids[..8]
        .iter()
        .enumerate()
        .map(|(index, id)| folder(id, index.checked_sub(1).map(|parent| ids[parent].as_str())))
        .collect();
    assert!(validate_folder_depth(&ids[7], Some(&ids[6]), &folders).is_ok());
    assert!(matches!(
        validate_folder_depth(&ids[8], Some(&ids[7]), &folders),
        Err(PersistenceError::InvalidData {
            message: crate::api::UserMessage::ResourceFolderDepthExceeded { max_depth: 8 }
        })
    ));
}

#[test]
fn folder_placement_checks_the_entire_subtree_for_moves_and_copies() {
    let ids: Vec<_> = (1..=10)
        .map(|id| uuid::Uuid::from_u128(id).to_string())
        .collect();
    let mut folders: Vec<_> = ids[..7]
        .iter()
        .enumerate()
        .map(|(index, id)| folder(id, index.checked_sub(1).map(|parent| ids[parent].as_str())))
        .collect();
    folders.extend([folder(&ids[7], None), folder(&ids[8], Some(&ids[7]))]);
    // The moved root fits at level eight, but its child would be level nine.
    assert!(validate_folder_depth(&ids[7], Some(&ids[6]), &folders).is_err());
    assert!(validate_folder_depth(&ids[7], Some(&ids[5]), &folders).is_ok());
    assert!(validate_folder_depth(&ids[7], None, &folders).is_ok());
}

#[test]
fn existing_deep_folders_can_be_renamed_and_relocated_to_a_shallower_position() {
    let ids: Vec<_> = (1..=9)
        .map(|id| uuid::Uuid::from_u128(id).to_string())
        .collect();
    let folders: Vec<_> = ids
        .iter()
        .enumerate()
        .map(|(index, id)| folder(id, index.checked_sub(1).map(|parent| ids[parent].as_str())))
        .collect();
    let mut edited = folders[8].clone();
    edited.name = "Renamed".into();
    assert!(validate_folder_relationships(&edited, &folders).is_ok());
    edited.parent_id = Some(ids[0].clone());
    assert!(validate_folder_relationships(&edited, &folders).is_ok());
}

#[test]
fn identity_validation_requires_canonical_non_nil_uuid() {
    assert!(validate_id("67e55044-10b1-426f-9247-bb680e5fe0c8").is_ok());
    for id in [
        "",
        "chunk",
        "../../file",
        "00000000-0000-0000-0000-000000000000",
        "67E55044-10B1-426F-9247-BB680E5FE0C8",
        "67e5504410b1426f9247bb680e5fe0c8",
    ] {
        assert!(matches!(
            validate_id(id),
            Err(PersistenceError::InvalidData {
                message: crate::api::UserMessage::InvalidResourceId
            })
        ));
    }
}

#[test]
fn impact_reference_inspection_matches_identity_fields_including_disabled_nodes() {
    let ids = HashSet::from(["resource".into()]);
    assert!(contains_reference(
        &serde_json::json!({"positive":[{"resourceId":"resource","enabled":false}]}),
        &ids
    ));
    assert!(!contains_reference(
        &serde_json::json!({"text":"resource"}),
        &ids
    ));
    assert!(!contains_reference(
        &serde_json::json!({"resourceId":"another"}),
        &ids
    ));
}

#[test]
fn resource_query_defaults_to_bounded_name_order() {
    let query = super::super::ResourceQuery::default();
    assert_eq!(query.sort, super::super::ResourceSort::Name);
    assert!(!query.descending);
    assert!(query.limit > 0 && query.limit <= 200);
    assert_eq!(query.offset, 0);
}

const PARENT_ID: &str = "0e2817b2-fcd7-4ff8-853e-677362d89466";

const CHILD_ID: &str = "e9bdb1f8-8baf-455c-81bd-bb54a0b29024";

const OTHER_ID: &str = "9a524515-aa3e-48cf-a4e7-46008601ba0c";

#[test]
fn renaming_a_folder_preserves_its_current_parent() {
    let mut latest = folder(CHILD_ID, Some(OTHER_ID));
    latest.name = "Original".into();
    apply_folder_changes(
        &mut latest,
        &[ResourceFolderChange::Name {
            name: "Renamed".into(),
        }],
    );
    assert_eq!(latest.name, "Renamed");
    assert_eq!(latest.parent_id.as_deref(), Some(OTHER_ID));
}

#[test]
fn moving_a_folder_preserves_its_current_name() {
    let mut latest = folder(CHILD_ID, Some(PARENT_ID));
    latest.name = "Latest name".into();
    apply_folder_changes(
        &mut latest,
        &[ResourceFolderChange::Parent {
            parent_id: Some(OTHER_ID.into()),
        }],
    );
    assert_eq!(latest.name, "Latest name");
    assert_eq!(latest.parent_id.as_deref(), Some(OTHER_ID));
}

#[test]
fn parent_change_can_explicitly_move_a_folder_to_the_root() {
    let mut latest = folder(CHILD_ID, Some(PARENT_ID));
    apply_folder_changes(
        &mut latest,
        &[ResourceFolderChange::Parent { parent_id: None }],
    );
    assert_eq!(latest.parent_id, None);
}

#[test]
fn folder_changes_are_applied_in_order_and_an_empty_edit_retains_current_fields() {
    let mut latest = folder(CHILD_ID, Some(PARENT_ID));
    let unchanged = latest.clone();
    apply_folder_changes(&mut latest, &[]);
    assert_eq!(latest, unchanged);
    apply_folder_changes(
        &mut latest,
        &[
            ResourceFolderChange::Name {
                name: "First".into(),
            },
            ResourceFolderChange::Parent { parent_id: None },
            ResourceFolderChange::Name {
                name: "Last".into(),
            },
        ],
    );
    assert_eq!(latest.name, "Last");
    assert_eq!(latest.parent_id, None);
}

#[test]
fn folder_relationships_require_an_existing_parent_and_unique_sibling_name() {
    let mut root = folder(PARENT_ID, None);
    root.name = "Collection".into();
    let folders = vec![root];
    let mut edited = folder(CHILD_ID, Some(OTHER_ID));
    assert!(matches!(
        validate_folder_relationships(&edited, &folders),
        Err(PersistenceError::NotFound { kind: "resource folder", id }) if id == OTHER_ID
    ));
    edited.parent_id = None;
    edited.name = " collection ".into();
    assert!(matches!(
        validate_folder_relationships(&edited, &folders),
        Err(PersistenceError::InvalidData {
            message: crate::api::UserMessage::ResourceFolderNameConflict
        })
    ));
    edited.parent_id = Some(PARENT_ID.into());
    assert!(validate_folder_relationships(&edited, &folders).is_ok());
}

#[test]
fn folder_relationships_reject_cycles_after_field_changes() {
    let parent = folder(PARENT_ID, None);
    let child = folder(CHILD_ID, Some(PARENT_ID));
    let folders = vec![parent.clone(), child];
    let mut edited = parent;
    apply_folder_changes(
        &mut edited,
        &[ResourceFolderChange::Parent {
            parent_id: Some(CHILD_ID.into()),
        }],
    );
    assert!(matches!(
        validate_folder_relationships(&edited, &folders),
        Err(PersistenceError::InvalidData {
            message: crate::api::UserMessage::ResourceFolderCycle
        })
    ));
}

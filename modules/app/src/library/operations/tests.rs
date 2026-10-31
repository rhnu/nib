use super::*;

fn folder(id: &str, parent: Option<&str>) -> ResourceFolder {
    ResourceFolder {
        id: id.into(),
        revision: 1,
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

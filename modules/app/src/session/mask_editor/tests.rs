use super::*;
use crate::{
    persistence::{PersistenceError, decode, encode},
    prompt::{Resource, ResourceReader, resolve_draft},
    session::{Draft, validate_draft},
};

fn session(source: &str) -> MaskSession {
    MaskSession {
        source_asset_id: source.to_owned(),
        width: 640,
        height: 832,
        base_mask_asset_id: Some("base-mask".into()),
        commands: vec![
            MaskCommand::Paint {
                points: vec![MaskPoint { x: 10.0, y: 20.0 }],
                size: 32.0,
            },
            MaskCommand::Erase {
                points: vec![MaskPoint { x: 11.0, y: 21.0 }],
                size: 16.0,
            },
            MaskCommand::Clear,
        ],
        cursor: 2,
        revision: 4,
        applied_revision: 1,
        applied_mask_asset_id: Some("applied-mask".into()),
        brush_size: 24.0,
        zoom: 2.0,
        pan_x: -30.0,
        pan_y: 50.0,
    }
}

fn editor() -> MaskEditorState {
    MaskEditorState {
        active_source_id: Some("second-source".into()),
        sessions: vec![session("first-source"), session("second-source")],
    }
}

#[test]
fn retained_draft_keeps_multiple_sources_unapplied_edits_redo_and_view_state() {
    let draft = Draft {
        mask_editor: editor(),
        ..Draft::default()
    };
    validate_draft(&draft).unwrap();
    let reopened: Draft = decode(&encode(&draft).unwrap()).unwrap();
    assert_eq!(reopened.mask_editor, draft.mask_editor);
    assert_eq!(reopened.mask_editor.sessions[0].cursor, 2);
    assert!(matches!(
        reopened.mask_editor.sessions[0].commands[2],
        MaskCommand::Clear
    ));
}

#[test]
fn invalid_history_and_nonfinite_coordinates_are_rejected_before_saving() {
    let mut value = editor();
    value.sessions[0].cursor = 4;
    assert_eq!(
        value.validate().unwrap_err().field,
        "maskEditor.sessions.cursor"
    );
    value.sessions[0].cursor = 2;
    let MaskCommand::Paint { points, .. } = &mut value.sessions[0].commands[0] else {
        unreachable!()
    };
    points[0].x = f64::NAN;
    assert_eq!(
        value.validate().unwrap_err().field,
        "maskEditor.sessions.commands.points"
    );
}

#[test]
fn source_selection_and_session_identity_are_unambiguous() {
    let mut value = editor();
    value.active_source_id = Some("absent-source".into());
    assert_eq!(
        value.validate().unwrap_err().field,
        "maskEditor.activeSourceId"
    );
    value.active_source_id = None;
    value.sessions.push(session("first-source"));
    assert_eq!(
        value.validate().unwrap_err().field,
        "maskEditor.sessions.sourceAssetId"
    );
    value.sessions.pop();
    value.sessions[0].width = 0;
    assert_eq!(
        value.validate().unwrap_err().field,
        "maskEditor.sessions.size"
    );
}

#[test]
fn mask_work_does_not_enter_resolved_or_sdk_generation_inputs() {
    struct NoResources;
    impl ResourceReader for NoResources {
        fn get_resource(&self, _: &str) -> Result<Option<Resource>, PersistenceError> { Ok(None) }
    }
    let draft = Draft {
        mask_editor: editor(),
        ..Draft::default()
    };
    let resolved = resolve_draft(&draft, &NoResources).unwrap();
    let wire = serde_json::to_value(&resolved).unwrap();
    assert!(wire.get("maskEditor").is_none());
    assert!(!wire.to_string().contains("second-source"));
    assert_eq!(resolved.inputs, Draft::default().inputs);
}

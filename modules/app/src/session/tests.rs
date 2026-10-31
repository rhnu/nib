use super::{Draft, PromptEditorState};

#[test]
fn prompt_editor_round_trip_preserves_scoped_explicit_choices() {
    let state = PromptEditorState {
        collapsed_blocks: [
            (r#"["positive","shared-node"]"#.to_owned(), true),
            (r#"["negative","shared-node"]"#.to_owned(), false),
        ]
        .into(),
    };

    let encoded = serde_json::to_value(&state).unwrap();
    assert_eq!(
        encoded["collapsedBlocks"][r#"["positive","shared-node"]"#],
        true
    );
    assert_eq!(
        encoded["collapsedBlocks"][r#"["negative","shared-node"]"#],
        false
    );
    let reopened: PromptEditorState = serde_json::from_value(encoded).unwrap();
    assert_eq!(reopened, state);
}

#[test]
fn draft_round_trip_retains_prompt_editor_choices() {
    let draft = Draft {
        prompt_editor: PromptEditorState {
            collapsed_blocks: [
                (r#"["positive","first-node"]"#.to_owned(), false),
                (r#"["positive","second-node"]"#.to_owned(), true),
            ]
            .into(),
        },
        ..Draft::default()
    };

    let encoded = serde_json::to_value(&draft).unwrap();
    let reopened: Draft = serde_json::from_value(encoded).unwrap();
    assert_eq!(reopened.prompt_editor, draft.prompt_editor);
    assert!(Draft::default().prompt_editor.collapsed_blocks.is_empty());
}

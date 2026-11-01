use novelai_bridge::{CharacterMetadata, ImageMetadata};

use super::draft_from_metadata;
use crate::prompt::PromptNode;

#[test]
fn recovers_character_text_and_empty_source_slots_without_inventing_positions() {
    let metadata = ImageMetadata {
        characters: vec![
            CharacterMetadata {
                source_index: 0,
                prompt: None,
                negative_prompt: None,
            },
            CharacterMetadata {
                source_index: 1,
                prompt: Some("red hair".into()),
                negative_prompt: Some("hat".into()),
            },
        ],
        ..ImageMetadata::default()
    };
    let draft = draft_from_metadata(&metadata);
    assert_eq!(draft.characters.len(), 2);
    assert_ne!(draft.characters[0].id, draft.characters[1].id);
    let PromptNode::Text { text, .. } = &draft.characters[1].composition.positive[0] else {
        panic!("expected literal character text")
    };
    assert_eq!(text, "red hair");
    let PromptNode::Text { text, .. } = &draft.characters[1].composition.negative[0] else {
        panic!("expected negative character text")
    };
    assert_eq!(text, "hat");
    assert_eq!(
        draft.characters[1].position,
        novelai_bridge::CharacterPosition::default()
    );
    assert!(draft.settings.use_coords.is_none());
}

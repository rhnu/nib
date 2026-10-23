use super::*;
use crate::session::{CreationOperation, Draft, PngTextSession, PngTextValue, validate_draft};

#[test]
fn director_drafts_retain_each_tool_and_png_patches_without_changing_generation() {
    let mut draft = Draft::default();
    draft.director.selected_tool = DirectorToolKind::Colorize;
    let emotion = draft
        .director
        .tools
        .iter_mut()
        .find(|state| state.tool == DirectorToolKind::Emotion)
        .unwrap();
    emotion.asset_id = Some("emotion-source".into());
    emotion.command = DirectorCommand::Emotion {
        prompt: "happy".into(),
        defry: 4,
    };
    emotion.policy = ValidationPolicy::Reject;
    emotion.selected_result_id = Some("emotion-result".into());
    let colorize = draft
        .director
        .tools
        .iter_mut()
        .find(|state| state.tool == DirectorToolKind::Colorize)
        .unwrap();
    colorize.asset_id = Some("colorize-source".into());
    colorize.command = DirectorCommand::Colorize {
        prompt: Some(String::new()),
        defry: 0,
    };
    draft.png_text_editor.sessions.push(PngTextSession {
        asset_id: "png-source".into(),
        entries: vec![PngTextValue {
            keyword: "custom".into(),
            text: String::new(),
        }],
        selected_output_asset_id: Some("png-output".into()),
    });
    validate_draft(&draft).unwrap();
    let restored: Draft = serde_json::from_slice(&serde_json::to_vec(&draft).unwrap()).unwrap();
    assert_eq!(restored.director, draft.director);
    assert_eq!(restored.png_text_editor, draft.png_text_editor);
    assert_eq!(restored.inputs.operation, CreationOperation::TextToImage);
}

#[test]
fn director_save_checks_identity_while_leaving_sdk_parameters_editable() {
    let mut draft = Draft::default();
    let emotion = draft
        .director
        .tools
        .iter_mut()
        .find(|state| state.tool == DirectorToolKind::Emotion)
        .unwrap();
    emotion.command = DirectorCommand::Emotion {
        prompt: String::new(),
        defry: 9,
    };
    validate_draft(&draft).unwrap();
    draft.director.tools[0].command = DirectorCommand::Sketch;
    assert_eq!(
        validate_draft(&draft).unwrap_err().field,
        "director.tools.command"
    );
}

use super::*;
use crate::session::{CreationOperation, PngTextSession, VibeEncodingInput};

#[test]
fn retained_png_sessions_keep_unique_sources_and_valid_output_identities() {
    let session = PngTextSession {
        asset_id: "source".into(),
        entries: Vec::new(),
        selected_output_asset_id: Some("output".into()),
    };
    let mut draft = Draft::default();
    draft.png_text_editor.sessions = vec![session.clone(), session];
    assert_eq!(
        validate_draft(&draft).unwrap_err().field,
        "pngTextEditor.sessions.assetId"
    );
    draft.png_text_editor.sessions.pop();
    draft.png_text_editor.sessions[0].selected_output_asset_id = Some(String::new());
    assert_eq!(
        validate_draft(&draft).unwrap_err().field,
        "pngTextEditor.sessions.selectedOutputAssetId"
    );
}

#[test]
fn encoding_identity_checks_apply_to_the_form_and_operation_without_sdk_validation() {
    let input = VibeEncodingInput {
        asset_id: "source".into(),
        model: novelai_bridge::Model::default(),
        information_extracted: -4.0,
        mask_asset_id: Some(String::new()),
        crop_to_mask: None,
        focus_seed: None,
        info_extract_seed: None,
    };
    let mut draft = Draft {
        vibe_encoder: Some(input.clone()),
        ..Draft::default()
    };
    assert_eq!(
        validate_draft(&draft).unwrap_err().field,
        "vibeEncoder.maskAssetId"
    );
    draft.vibe_encoder = None;
    draft.inputs.operation = CreationOperation::EncodeVibe(input);
    assert_eq!(
        validate_draft(&draft).unwrap_err().field,
        "inputs.operation.maskAssetId"
    );
    if let CreationOperation::EncodeVibe(input) = &mut draft.inputs.operation {
        input.mask_asset_id = None;
    }
    validate_draft(&draft).unwrap();
}

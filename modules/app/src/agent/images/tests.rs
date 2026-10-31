use std::collections::HashMap;

use rig_core::message::{CallId, ToolName, ToolResultContent};

use super::*;

#[test]
fn attachments_and_tool_images_retain_asset_references_instead_of_bytes() {
    let bytes = vec![1, 2, 3, 4];
    let image = Image {
        data: DocumentSourceKind::Raw(bytes.clone()),
        ..Image::default()
    };
    let record = AgentMessage {
        id: "message".into(),
        role: "user".into(),
        content: "Compare these images".into(),
        asset_ids: vec!["attachment".into()],
        tool_name: None,
        success: None,
    };
    let mut messages = vec![
        user_message(&record),
        Message::User {
            content: vec![UserContent::Image(image.clone())],
        },
        Message::User {
            content: vec![UserContent::tool_result(
                CallId::from_wire("call"),
                ToolName::new("read_image").unwrap(),
                vec![ToolResultContent::Image(image)],
            )],
        },
    ];
    retain_references(
        &mut messages,
        &HashMap::from([(BlobId::for_bytes(&bytes), "generated".into())]),
    )
    .unwrap();
    let sources: Vec<_> = messages
        .iter()
        .flat_map(Message::images)
        .map(|image| image.data.clone())
        .collect();
    assert_eq!(
        sources,
        vec![
            DocumentSourceKind::Url("nib-asset:attachment".into()),
            DocumentSourceKind::Url("nib-asset:generated".into()),
            DocumentSourceKind::Url("nib-asset:generated".into())
        ]
    );
}

#[test]
fn untracked_binary_output_is_rejected_instead_of_saved() {
    let mut messages = vec![Message::User {
        content: vec![UserContent::Image(Image {
            data: DocumentSourceKind::Raw(vec![9]),
            ..Image::default()
        })],
    }];
    assert!(retain_references(&mut messages, &HashMap::new()).is_err());
}

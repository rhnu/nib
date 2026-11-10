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

#[test]
fn extension_images_keep_other_blocks_and_retain_prepared_bytes() {
    let original = vec![1, 2, 3];
    let prepared = vec![4, 5];
    let text = ToolResultContent::text("instructions remain available to the model");
    let json = ToolResultContent::json(json!({"items":[1,2]}));
    let output = ToolOutput::content(vec![
        text.clone(),
        ToolResultContent::Image(Image {
            data: DocumentSourceKind::Raw(original.clone()),
            ..Image::default()
        }),
        json.clone(),
    ])
    .unwrap();
    let (output, asset_ids) = map_extension_images(output, |image| {
        assert_eq!(image.data, DocumentSourceKind::Raw(original.clone()));
        Ok((
            Image {
                data: DocumentSourceKind::Raw(prepared.clone()),
                ..Image::default()
            },
            "imported".into(),
        ))
    })
    .unwrap();
    assert_eq!(output.as_content()[0], text);
    assert_eq!(output.as_content()[2], json);
    assert_eq!(asset_ids, ["imported"]);
    let mut messages = [Message::User {
        content: vec![UserContent::tool_result(
            CallId::from_wire("extension"),
            ToolName::new("mcp_image").unwrap(),
            output.into_content(),
        )],
    }];
    retain_references(
        &mut messages,
        &HashMap::from([(BlobId::for_bytes(&prepared), "imported".into())]),
    )
    .unwrap();
    assert_eq!(
        messages[0].images().next().unwrap().data,
        DocumentSourceKind::Url("nib-asset:imported".into())
    );
}

#[test]
fn extension_image_sources_reuse_sdk_base64_decoding() {
    let mut bytes = Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(1, 1)
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    let bytes = bytes.into_inner();
    let encoded = novelai_bridge::EncodedImage::from_bytes(bytes.clone())
        .unwrap()
        .to_base64();
    let source = extension_image_source(DocumentSourceKind::Base64(encoded)).unwrap();
    assert!(matches!(source, ExtensionImageSource::Bytes(decoded) if decoded == bytes));
    let source = extension_image_source(DocumentSourceKind::Url("nib-asset:local".into())).unwrap();
    assert!(matches!(source, ExtensionImageSource::Asset(id) if id == "local"));
}

#[test]
fn extension_image_sources_reject_unretained_media_and_preserve_decode_errors() {
    for source in [
        DocumentSourceKind::Unknown,
        DocumentSourceKind::FileId("provider-file".into()),
        DocumentSourceKind::Url("https://example.com/image.png".into()),
        DocumentSourceKind::Url("nib-asset:".into()),
    ] {
        assert!(matches!(
            extension_image_source(source),
            Err(AgentError::Invalid(_))
        ));
    }
    let Err(error) = extension_image_source(DocumentSourceKind::Base64("invalid!".into())) else {
        panic!("invalid base64 must fail");
    };
    assert!(matches!(
        error,
        AgentError::Persistence(PersistenceError::Failure { .. })
    ));
    assert!(std::error::Error::source(&error).is_some());
}

#[test]
fn unsupported_mcp_binary_blocks_fail_while_text_resources_remain_intact() {
    for value in [
        json!({"type":"audio","data":"binary","mimeType":"audio/wav"}),
        json!({"type":"image","data":"binary","mimeType":"image/unsupported"}),
        json!({"type":"resource","resource":{"uri":"file:test","blob":"binary"}}),
    ] {
        let result = map_extension_images(ToolOutput::json(value), |_| unreachable!());
        assert!(matches!(result, Err(AgentError::Invalid(_))));
    }
    let text_resource = ToolOutput::json(
        json!({"type":"resource","resource":{"uri":"file:text","text":"complete resource body"}}),
    );
    let (retained, ids) = map_extension_images(text_resource.clone(), |_| unreachable!()).unwrap();
    assert_eq!(retained, text_resource);
    assert_eq!(ids, Vec::<String>::new());
}

#[test]
fn media_rejection_does_not_claim_storage_failure() {
    let rejected =
        extension_image_source(DocumentSourceKind::Url("https://example.com/image".into()));
    let Err(error) = rejected else {
        panic!("remote image must be rejected");
    };
    assert!(!extension_storage_failure(&error));
    let Err(error) = extension_image_source(DocumentSourceKind::Base64("invalid!".into())) else {
        panic!("invalid image must be rejected");
    };
    assert!(image_validation_failure(&error));
    assert!(!extension_storage_failure(&error));
    let io =
        PersistenceError::failure("save imported image", std::io::Error::other("disk failure"));
    assert!(extension_storage_failure(&io.into()));
    assert!(extension_storage_failure(&AgentError::Locked));
}

#[test]
fn failed_tool_record_uses_bounded_diagnostic_text() {
    let output = ToolOutput::content(vec![
        ToolResultContent::Image(Image::default()),
        ToolResultContent::text("request rejected"),
        ToolResultContent::json(json!({"large":"unused body"})),
    ])
    .unwrap();
    assert_eq!(extension_failure_text(&output), "request rejected");
    let long = ToolOutput::text("字".repeat(2048));
    assert_eq!(extension_failure_text(&long).chars().count(), 1024);
}

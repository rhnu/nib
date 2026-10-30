use super::*;

#[test]
fn typed_messages_preserve_parameters_through_storage_and_ipc() {
    let message = UserMessage::Validation {
        field: "references.assetId".to_owned(),
        message: Box::new(UserMessage::MediaUnavailable {
            id: "example-media".to_owned(),
        }),
    };
    let json = serde_json::to_value(&message).unwrap();
    assert_eq!(json["kind"], "validation");
    assert_eq!(json["field"], "references.assetId");
    assert_eq!(json["message"]["kind"], "mediaUnavailable");
    assert_eq!(json["message"]["id"], "example-media");
    assert_eq!(
        serde_json::from_value::<UserMessage>(json).unwrap(),
        message
    );
}

#[test]
fn external_messages_keep_full_local_diagnostics() {
    let source = std::io::Error::other("the image contains an invalid text entry");
    let error = crate::persistence::PersistenceError::failure("inspect image", source);
    assert_eq!(
        error.user_message(),
        UserMessage::StorageFailure {
            operation: "inspect image".to_owned(),
            detail: "the image contains an invalid text entry".to_owned(),
        }
    );
}

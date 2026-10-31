use super::*;

#[test]
fn model_status_exposes_recovery_and_failures_without_requiring_a_session() {
    let pending = model_status(nib_image_analysis::ModelStatus {
        identity: None,
        loading: true,
        error: None,
    });
    assert!(pending.loading);
    assert!(!pending.available);
    assert!(pending.error.is_none());

    let failed = model_status(nib_image_analysis::ModelStatus {
        identity: Some(ModelIdentity {
            version: "test".into(),
            generation: "test".into(),
            revision: "test".into(),
        }),
        loading: false,
        error: Some("invalid model".into()),
    });
    assert!(!failed.available);
    assert!(!failed.loading);
    assert!(failed.error.is_some());
    assert!(failed.version.is_some());
}

#[test]
fn extracted_tags_use_novelai_names_and_descending_confidence() {
    let tags = select_tags(
        vec![
            RawTag {
                name: "blue_hair".to_owned(),
                confidence: 0.6,
            },
            RawTag {
                name: "red_eyes".to_owned(),
                confidence: 0.9,
            },
            RawTag {
                name: "low_confidence".to_owned(),
                confidence: 0.1,
            },
        ],
        0.5,
    );
    assert_eq!(tags.len(), 2);
    assert_eq!(tags[0].name, "red_eyes");
    assert_eq!(tags[0].prompt_text, "red eyes");
    assert_eq!(tags[1].prompt_text, "blue hair");
}

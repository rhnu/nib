use serde_json::json;

use super::*;

fn novelai_query(sort: NovelAiSort) -> ExploreQuery {
    ExploreQuery::NovelAi {
        sort,
        period: Some(NovelAiPeriod::Week),
        tags: vec![],
        creator_id: None,
        random_seed: (sort == NovelAiSort::Random).then(|| "shuffle-one".into()),
    }
}

#[test]
fn random_has_one_selector_and_rejects_other_filters() {
    let mut query = novelai_query(NovelAiSort::Random);
    validate_query(&query).unwrap();
    let body = sources::novelai_body(&query, 0).unwrap();
    assert_eq!(body["selectors"].as_array().unwrap().len(), 1);
    assert_eq!(body["selectors"][0]["field"], "random");
    assert!(
        body["selectors"][0]["value"]
            .as_str()
            .unwrap()
            .ends_with(":shuffle-one")
    );
    if let ExploreQuery::NovelAi { tags, .. } = &mut query {
        tags.push("sky".into());
    }
    assert_eq!(
        validate_query(&query).unwrap_err().kind,
        ExploreErrorKind::InvalidQuery
    );
}

#[test]
fn pagination_rejects_a_different_query_source_or_connection() {
    let query = ExploreQuery::Danbooru {
        tags: "cloud".into(),
        ratings: vec![ExploreRating::General],
    };
    let cursor = serde_json::to_string(&Cursor {
        query: query.clone(),
        revision: 7,
        before: Some("120".into()),
        offset: 0,
    })
    .unwrap();
    assert!(decode_cursor(Some(&cursor), &query, 7).is_ok());
    assert_eq!(
        decode_cursor(Some(&cursor), &query, 8).unwrap_err().kind,
        ExploreErrorKind::StaleIdentity
    );
    assert_eq!(
        decode_cursor(Some(&cursor), &novelai_query(NovelAiSort::New), 7)
            .unwrap_err()
            .kind,
        ExploreErrorKind::StaleIdentity
    );
    let changed = ExploreQuery::Danbooru {
        tags: "rain".into(),
        ratings: vec![ExploreRating::General],
    };
    assert_eq!(
        decode_cursor(Some(&cursor), &changed, 7).unwrap_err().kind,
        ExploreErrorKind::StaleIdentity
    );
}

#[test]
fn largest_valid_escaped_query_can_continue_pagination() {
    let query = ExploreQuery::NovelAi {
        sort: NovelAiSort::Top,
        period: Some(NovelAiPeriod::Month),
        tags: vec!["\u{0001}".repeat(256); 32],
        creator_id: Some("creator".repeat(18)),
        random_seed: None,
    };
    validate_query(&query).unwrap();
    let cursor = serde_json::to_string(&Cursor {
        query: query.clone(),
        revision: 0,
        before: None,
        offset: 40,
    })
    .unwrap();
    assert!(cursor.len() > 8192);
    assert!(decode_cursor(Some(&cursor), &query, 0).is_ok());
}

#[test]
fn latest_danbooru_owns_order_and_rating_filters() {
    assert!(
        validate_query(&ExploreQuery::Danbooru {
            tags: String::new(),
            ratings: vec![]
        })
        .is_err()
    );
    for tags in ["order:score", "cat -rating:e", "is:nsfw", "page:2"] {
        assert!(
            validate_query(&ExploreQuery::Danbooru {
                tags: tags.into(),
                ratings: vec![ExploreRating::General]
            })
            .is_err()
        );
    }
    assert!(
        validate_query(&ExploreQuery::Danbooru {
            tags: "1girl -rain".into(),
            ratings: vec![ExploreRating::Sensitive]
        })
        .is_ok()
    );
}

#[test]
fn media_accepts_only_source_supplied_cdn_https_urls() {
    for url in [
        "http://cdn.donmai.us/image.png",
        "https://evil.test/image.png",
        "https://secret@cdn.donmai.us/image.png",
        "https://cdn.donmai.us:8443/image.png",
    ] {
        let raw = json!({"file_url":url});
        assert!(sources::danbooru_media_url(&raw, ExploreMediaVariant::Original).is_err());
    }
    let raw = json!({"file_url":"https://cdn.donmai.us/original/a.png"});
    assert!(sources::danbooru_media_url(&raw, ExploreMediaVariant::Original).is_ok());
    assert!(sources::danbooru_media_url(&raw, ExploreMediaVariant::Thumbnail).is_err());
}

#[test]
fn only_public_approved_novelai_images_are_visible() {
    let mut post = json!({"id":"51d453b3-172f-4227-9c5d-c05dd180dd6c","type":1,"moderation_status":1,"deleted":false,"created_at":"2026-10-30","image":{"width":512,"height":512,"nai_metadata":null}});
    assert!(sources::decode_detail(ExploreSource::NovelAi, &post, 0).is_ok());
    post["moderation_status"] = json!(0);
    assert_eq!(
        sources::decode_detail(ExploreSource::NovelAi, &post, 0)
            .unwrap_err()
            .kind,
        ExploreErrorKind::NotFound
    );
}

#[test]
fn nested_metadata_preserves_positive_negative_and_character_text() {
    let raw=json!(json!({"Description":"fallback","Comment":json!({"prompt":"legacy","uc":"noise","seed":0,"model_name":"future-model","v4_prompt":{"caption":{"base_caption":"2::sky:: // literal","char_captions":[{"char_caption":"first"},{"char_caption":""}]}},"v4_negative_prompt":{"caption":{"base_caption":"negative","char_captions":[{"char_caption":"blur"}]}}}).to_string()}).to_string());
    let (view, parsed) = metadata::interpret(Some(&raw));
    assert_eq!(view.status, ExploreMetadataStatus::Available);
    assert_eq!(view.prompt.as_deref(), Some("2::sky:: // literal"));
    assert_eq!(view.negative_prompt.as_deref(), Some("negative"));
    assert_eq!(view.characters, vec!["first", ""]);
    assert_eq!(view.negative_characters, vec!["blur", ""]);
    let parsed = parsed.unwrap();
    assert_eq!(parsed.seed, Some(0));
    assert!(parsed.origin.is_none());
    assert_eq!(
        metadata::restore(Some(&raw), Draft::default())
            .unwrap_err()
            .kind,
        ExploreErrorKind::InvalidResponse
    );
}

#[test]
fn partial_metadata_keeps_description_and_refuses_unreliable_restore() {
    let raw = json!(json!({"Description":"sky","Comment":"{"}).to_string());
    let (view, _) = metadata::interpret(Some(&raw));
    assert_eq!(view.status, ExploreMetadataStatus::Partial);
    assert_eq!(view.prompt.as_deref(), Some("sky"));
    assert!(metadata::restore(Some(&raw), Draft::default()).is_err());
    let prompt_only = json!(json!({"Comment":json!({"prompt":"sky"}).to_string()}).to_string());
    assert_eq!(
        metadata::interpret(Some(&prompt_only)).0.status,
        ExploreMetadataStatus::Partial
    );
    assert_eq!(
        metadata::interpret(Some(&json!("bad"))).0.status,
        ExploreMetadataStatus::Invalid
    );
}

#[test]
fn restore_uses_existing_literal_prompt_rules_and_reports_missing_materials() {
    let model = serde_json::to_value(novelai_bridge::Model::default()).unwrap();
    let raw=json!(json!({"Comment":json!({"prompt":"sky // literal","uc":"blur","model":model,"v4_prompt":{"caption":{"char_captions":[{"char_caption":"actor"}]}}}).to_string()}).to_string());
    let restored = metadata::restore(Some(&raw), Draft::default()).unwrap();
    assert_eq!(
        restored.draft.settings.quality,
        Some(novelai_bridge::QualityPreset::None)
    );
    assert_eq!(
        restored.draft.settings.uc_preset,
        Some(novelai_bridge::UcPreset::None)
    );
    assert_eq!(restored.draft.characters.len(), 0);
    assert!(matches!(
        restored.draft.inputs.operation,
        crate::session::CreationOperation::TextToImage
    ));
    assert!(restored.notices.iter().any(|notice| matches!(
        notice,
        crate::api::UserMessage::RestoreCharactersUnavailable
    )));
    assert!(restored.notices.len() >= 4);
    let crate::prompt::PromptNode::Text { text, .. } = &restored.draft.composition.positive[0]
    else {
        panic!("expected literal prompt");
    };
    assert_eq!(
        nib_prompt::compile(text, nib_prompt::PromptSyntaxProfile::default()).text,
        "sky // literal"
    );
}

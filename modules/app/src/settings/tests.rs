use super::*;

#[test]
fn semantic_search_defaults_to_enabled_for_existing_preferences() {
    let mut existing = serde_json::to_value(ApplicationPreferences::default()).unwrap();
    existing
        .as_object_mut()
        .unwrap()
        .remove("semanticSearchEnabled");
    let restored: ApplicationPreferences = serde_json::from_value(existing).unwrap();
    assert!(restored.semantic_search_enabled);
}

#[test]
fn semantic_search_choice_survives_preference_serialization() {
    for enabled in [false, true] {
        let preferences = ApplicationPreferences {
            semantic_search_enabled: enabled,
            ..ApplicationPreferences::default()
        };
        let stored = serde_json::to_value(&preferences).unwrap();
        let restored: ApplicationPreferences = serde_json::from_value(stored).unwrap();
        assert_eq!(restored.semantic_search_enabled, enabled);
    }
}

#[test]
fn default_execution_keeps_sdk_default_behavior() {
    assert_eq!(
        ExecutionPreferences::default().client_config(),
        novelai_bridge::ClientConfig::default()
    );
}

#[test]
fn execution_preferences_rebuild_the_sdk_options_without_changing_routing_or_budgets() {
    let execution = ExecutionPreferences {
        image_request_encoding: ImageRequestEncoding::Multipart,
        server_image_cache: true,
        ..ExecutionPreferences::default()
    };
    let config = execution.client_config();
    assert_eq!(
        config.image_request_encoding,
        novelai_bridge::ImageRequestEncoding::Multipart
    );
    assert_eq!(
        config.image_cache,
        Some(novelai_bridge::ImageCacheConfig::default())
    );
    let defaults = novelai_bridge::ClientConfig::default();
    assert_eq!(config.image_base_url, defaults.image_base_url);
    assert_eq!(config.response_limits, defaults.response_limits);
}

#[test]
fn custom_base_url_is_passed_to_the_sdk_with_its_path_prefix() {
    let execution = ExecutionPreferences {
        image_base_url: Some("https://example.test/novelai/".to_owned()),
        ..ExecutionPreferences::default()
    };
    assert_eq!(
        execution.client_config().image_base_url,
        "https://example.test/novelai/"
    );
}

#[test]
fn language_preferences_default_to_system_and_keep_the_selected_language() {
    assert_eq!(ApplicationPreferences::default().language, Language::System);
    for (language, wire) in [
        (Language::System, "system"),
        (Language::En, "en"),
        (Language::ZhCn, "zh-CN"),
    ] {
        let preferences = ApplicationPreferences {
            language,
            ..ApplicationPreferences::default()
        };
        let json = serde_json::to_value(&preferences).unwrap();
        assert_eq!(json["language"], wire);
        assert_eq!(
            serde_json::from_value::<ApplicationPreferences>(json).unwrap(),
            preferences
        );
    }
}

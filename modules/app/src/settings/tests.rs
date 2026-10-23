use super::*;

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

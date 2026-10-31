use super::*;

#[test]
fn running_conflicts_are_distinct_from_provider_failure() {
    assert!(!AgentError::Provider.is_conflict());
    assert!(AgentError::Busy.is_conflict());
}

#[cfg(feature = "native")]
#[test]
fn connection_rejects_credentials_or_query_secrets() {
    for endpoint in [
        "https://user:secret@example.test/v1",
        "https://example.test/v1?api_key=secret",
        "file:///tmp/model",
    ] {
        assert!(
            super::runtime::normalize_connection(AgentConnectionConfig {
                endpoint: endpoint.into(),
                model: "model".into(),
                api: AgentApi::Responses
            })
            .is_err()
        );
    }
    let config = super::runtime::normalize_connection(AgentConnectionConfig {
        endpoint: " https://example.test/v1/ ".into(),
        model: " model ".into(),
        api: AgentApi::ChatCompletions,
    })
    .unwrap();
    assert_eq!(config.endpoint, "https://example.test/v1");
    assert_eq!(config.model, "model");
}

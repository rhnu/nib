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
                model: "model".into(),
                provider: AgentProvider::Custom {
                    endpoint: endpoint.into(),
                    api: AgentApi::Responses
                },
            })
            .is_err()
        );
    }
    let config = super::runtime::normalize_connection(AgentConnectionConfig {
        model: " model ".into(),
        provider: AgentProvider::Custom {
            endpoint: " https://example.test/v1/ ".into(),
            api: AgentApi::ChatCompletions,
        },
    })
    .unwrap();
    assert_eq!(config.provider.endpoint(), "https://example.test/v1");
    assert_eq!(config.model, "model");
}

#[test]
fn official_connections_use_responses_while_custom_connections_keep_their_protocol() {
    for provider in [
        AgentProvider::OpenAi,
        AgentProvider::DeepSeek,
        AgentProvider::OpenRouter,
    ] {
        assert_eq!(provider.api(), AgentApi::Responses);
    }
    assert_eq!(
        AgentProvider::Custom {
            endpoint: "https://example.test/v1".into(),
            api: AgentApi::ChatCompletions
        }
        .api(),
        AgentApi::ChatCompletions
    );
}

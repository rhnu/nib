//! Configure compatible wires without allowing model-name heuristics to discard attached images.

use rig_core::{
    catalog::{ModelFacts, ModelSpec},
    providers::{
        openai::{
            OpenAIConfig,
            wire::{OPENAI, OPENROUTER},
        },
        registry::ProviderId,
    },
};

use super::{AgentApi, AgentConnectionConfig};

pub(super) fn provider(endpoint: &str, key: String) -> OpenAIConfig {
    let url = reqwest::Url::parse(endpoint).expect("connection endpoint was normalized");
    let dialect = match url.host_str() {
        Some("openrouter.ai") => &OPENROUTER,
        // The generic compatible wire preserves DeepSeek reasoning by endpoint and, unlike
        // Rig's current dedicated dialect, does not unconditionally omit image parts.
        _ => &OPENAI,
    };
    OpenAIConfig::new(key)
        .with_dialect(dialect)
        .with_base_url(endpoint)
}

fn image_facts(facts: &ModelFacts, vendor: &str, model: &str) -> ModelFacts {
    let mut spec = facts.for_model(vendor, model).cloned().unwrap_or_else(|| {
        ModelSpec::new(
            ProviderId::catalog(vendor).expect("only built-in compatible dialects are used"),
            model,
        )
    });
    // Custom aliases and newly released models need not exist in Rig's catalog. The request
    // must carry the actual image; the service is responsible for accepting or rejecting it.
    spec.input.image = true;
    ModelFacts::new(spec)
}

pub(super) fn model(
    config: &AgentConnectionConfig,
    key: String,
) -> rig_core::DynModel<rig_core::operation::Completion> {
    let client = provider(config.provider.endpoint(), key).client();
    match config.provider.api() {
        AgentApi::ChatCompletions => {
            let mut model = client.chat(&config.model);
            model.wire.facts = image_facts(
                &model.wire.facts,
                model.wire.provider.dialect.name,
                &config.model,
            );
            model.into()
        },
        AgentApi::Responses => {
            let mut model = client.responses(&config.model);
            model.wire.facts = image_facts(
                &model.wire.facts,
                model.wire.provider.dialect.name,
                &config.model,
            );
            model.into()
        },
    }
}

#[cfg(test)]
mod tests;

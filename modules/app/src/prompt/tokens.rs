//! Local inspection of literal prompt text, independent of generation preparation.

use novelai_bridge::{
    FramingPolicy, ImageTokenizerKind, Model, TokenCount, TokenId, TokenizerError, Tokenizers,
};
use serde::Serialize;

/// Literal-text tokens and their model limit; request prompt transformations are not applied.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct TokenInspection {
    #[cfg_attr(feature = "typegen", ts(type = "string"))]
    pub model: Model,
    #[cfg_attr(feature = "typegen", ts(type = "string"))]
    pub tokenizer: ImageTokenizerKind,
    #[cfg_attr(feature = "typegen", ts(type = "\"content_only\" | \"model_input\""))]
    pub framing: FramingPolicy,
    #[cfg_attr(feature = "typegen", ts(type = "{ used: number; limit: number }"))]
    pub count: TokenCount,
    pub token_ids: Vec<TokenId>,
}

/// Encodes exactly the supplied text with explicit content-only or model-input framing.
///
/// This does not resolve quality presets, UC presets, weighting or composition. The SDK owns
/// both the encoder and model limit; no client, credentials or media are required.
///
/// # Errors
/// Returns the SDK error when the selected model's encoder is absent or encoding fails.
pub fn inspect_tokens(
    tokenizers: &Tokenizers,
    model: Model,
    text: &str,
    framing: FramingPolicy,
) -> Result<TokenInspection, TokenizerError> {
    let token_ids = tokenizers.require_for_model(model)?.encode(text, framing)?;
    // SDK TokenCount uses a u32 count; keep the returned IDs and count from this one encoding.
    let used = u32::try_from(token_ids.len()).unwrap_or(u32::MAX);
    let profile = model.descriptor().prompt();
    Ok(TokenInspection {
        model,
        tokenizer: profile.tokenizer,
        framing,
        count: TokenCount::new(used, profile.token_limit),
        token_ids,
    })
}

#[cfg(test)]
mod tests;

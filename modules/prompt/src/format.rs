//! Canonical tag insertion delegates native grammar classification to the SDK.

use serde::{Deserialize, Serialize};

use crate::{PromptSyntaxProfile, PromptTokenKind, analyze_prompt, native_to_source};

/// Null keeps normal weight; legacy models interpret a number as bracket emphasis layers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct LexiconFormatTerm {
    pub name: String,
    pub weight: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum LexiconFormatError {
    #[error("A lexicon term must have a non-empty name.")]
    EmptyName,
    #[error("The term weight must be finite.")]
    NonFiniteWeight,
    #[error("The current model does not support negative numeric weights.")]
    NegativeWeightUnsupported,
    #[error("The current model does not support term weights.")]
    WeightUnsupported,
    #[error("Bracket emphasis requires an integer between -30 and 30.")]
    InvalidBracketLayers,
}

/// Produces editable nib source while keeping canonical syntax characters literal.
///
/// # Errors
///
/// Rejects empty names, non-finite or unsupported weights, and legacy emphasis values
/// that are not integer layer counts within the supported insertion range.
#[expect(
    clippy::float_cmp,
    reason = "Exact zero and one choose unweighted syntax; approximation would change the requested weight"
)]
pub fn format_lexicon_terms(
    terms: &[LexiconFormatTerm],
    profile: PromptSyntaxProfile,
) -> Result<String, LexiconFormatError> {
    let mut formatted = Vec::with_capacity(terms.len());
    for term in terms {
        if term.name.trim().is_empty() {
            return Err(LexiconFormatError::EmptyName);
        }
        let mut name = String::with_capacity(term.name.len());
        for token in analyze_prompt(&term.name, profile).tokens {
            if token.kind == PromptTokenKind::Text {
                name.push_str(&token.text);
            } else {
                // Escaping each scalar also neutralizes multi-character operators such as || or ::.
                for ch in token.text.chars() {
                    name.push('\\');
                    name.push(ch);
                }
            }
        }
        if let Some(weight) = term.weight {
            if !weight.is_finite() {
                return Err(LexiconFormatError::NonFiniteWeight);
            }
            if profile.numeric_weights {
                if weight < 0.0 && !profile.negative_weights {
                    return Err(LexiconFormatError::NegativeWeightUnsupported);
                }
                if weight != 1.0 {
                    name = format!("{weight}::{name}::");
                }
            } else if weight != 0.0 {
                if !profile.bracket_weights {
                    return Err(LexiconFormatError::WeightUnsupported);
                }
                if weight.fract() != 0.0 || !(-30.0..=30.0).contains(&weight) {
                    return Err(LexiconFormatError::InvalidBracketLayers);
                }
                let mut remaining = weight.abs();
                let mut open = String::new();
                let mut close = String::new();
                while remaining >= 1.0 {
                    open.push(if weight > 0.0 { '{' } else { '[' });
                    close.push(if weight > 0.0 { '}' } else { ']' });
                    remaining -= 1.0;
                }
                name = format!("{open}{name}{close}");
            }
        }
        formatted.push(name);
    }
    Ok(native_to_source(&formatted.join(", "), profile))
}

#[cfg(test)]
mod tests;

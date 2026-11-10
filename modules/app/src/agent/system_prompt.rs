//! Global prompt replacement and comparison against the shipped instructions.

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

use super::{AgentError, AgentSystemPrompt};

#[cfg(feature = "native")]
pub(crate) const BUILT_IN: &str = include_str!("system-prompt.txt");

/// Stores only the user replacement and the built-in version it was edited against.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct StoredSystemPrompt {
    pub custom_prompt: String,
    pub built_in_hash: String,
}

impl StoredSystemPrompt {
    /// Re-saving the same text preserves its baseline so an update notice stays visible.
    pub(crate) fn replacement(
        previous: Option<&Self>,
        custom_prompt: Option<String>,
        built_in: &str,
    ) -> Option<Self> {
        let custom_prompt = custom_prompt?;
        if let Some(previous) = previous
            && previous.custom_prompt == custom_prompt
        {
            return Some(previous.clone());
        }
        Some(Self {
            custom_prompt,
            built_in_hash: hash(built_in),
        })
    }
}

impl AgentSystemPrompt {
    pub(crate) fn from_stored(stored: Option<StoredSystemPrompt>, built_in: &str) -> Self {
        Self {
            built_in: built_in.to_owned(),
            built_in_changed: stored
                .as_ref()
                .is_some_and(|stored| stored.built_in_hash != hash(built_in)),
            custom_prompt: stored.map(|stored| stored.custom_prompt),
        }
    }

    pub(crate) fn effective(&self) -> &str {
        self.custom_prompt.as_deref().unwrap_or(&self.built_in)
    }
}

pub(crate) fn validate_custom_prompt(custom_prompt: Option<&str>) -> Result<(), AgentError> {
    if custom_prompt.is_some_and(|prompt| prompt.trim().is_empty()) {
        return Err(AgentError::Invalid(
            "Enter a nonempty assistant system prompt.",
        ));
    }
    Ok(())
}

fn hash(prompt: &str) -> String {
    let mut hash = String::with_capacity(64);
    for byte in Sha256::digest(prompt.as_bytes()) {
        write!(&mut hash, "{byte:02x}").expect("writing a String is infallible");
    }
    hash
}

#[cfg(test)]
mod tests;

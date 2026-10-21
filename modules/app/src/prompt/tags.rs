//! Replaceable tag completion preserves the SDK's language-specific suggestions.

use async_trait::async_trait;
use novelai_bridge::{BridgeError, Client, SuggestTagsRequest, SuggestTagsResult, Transport};

/// A prompt-domain query capability, selected and shared by the host.
#[async_trait]
pub trait TagQuery: Send + Sync {
    /// Returns suggestions in provider order, retaining each language's ranking fields.
    ///
    /// # Errors
    /// Returns the underlying SDK transport, status or response-decoding failure.
    async fn suggest_tags(
        &self,
        query: SuggestTagsRequest,
    ) -> Result<SuggestTagsResult, BridgeError>;
}

#[async_trait]
impl<T: Transport + ?Sized> TagQuery for Client<T> {
    async fn suggest_tags(
        &self,
        query: SuggestTagsRequest,
    ) -> Result<SuggestTagsResult, BridgeError> {
        Self::suggest_tags(self, query).await
    }
}

#[cfg(test)]
mod tests;

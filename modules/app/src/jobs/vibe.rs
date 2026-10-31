//! Complete known encoding inputs are indexed independently of official opaque cache keys.

use serde::Serialize;

use super::{Draft, FrozenSubmission, JobError, JobQueue, JobRecord};
use crate::{
    api::UserMessage,
    media::{AssetReader, BlobId},
    persistence::PersistenceError,
};

/// SHA-256 identity of the complete effective encoding input, distinct from media content.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DerivationKey(BlobId);

impl DerivationKey {
    pub fn as_str(&self) -> &str { self.0.as_str() }

    /// Hashes a versioned binary representation with explicit option tags and float bits.
    fn for_submission(
        submission: &FrozenSubmission,
        assets: &dyn AssetReader,
    ) -> Result<Option<Self>, JobError> {
        let FrozenSubmission::EncodeVibe {
            asset_id,
            model,
            information_extracted,
            mask_asset_id,
            crop_to_mask,
            focus_seed,
            info_extract_seed,
            ..
        } = submission
        else {
            return Ok(None);
        };
        let image = assets
            .image_identity(asset_id)
            .map_err(|source| JobError::InputMedia { source })?;
        let mask = mask_asset_id
            .as_deref()
            .map(|id| assets.image_identity(id))
            .transpose()
            .map_err(|source| JobError::InputMedia { source })?;
        let mut bytes = b"nib/vibe-encoding\0".to_vec();
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        // SHA-256 text has fixed length; the optional model key is length-prefixed.
        bytes.extend_from_slice(image.as_str().as_bytes());
        bytes.push(u8::from(mask.is_some()));
        if let Some(mask) = mask {
            bytes.extend_from_slice(mask.as_str().as_bytes());
        }
        bytes.push(u8::from(model.vibe_model_key().is_some()));
        if let Some(model) = model.vibe_model_key() {
            bytes.extend_from_slice(&(model.len() as u64).to_le_bytes());
            bytes.extend_from_slice(model.as_bytes());
        }
        bytes.extend_from_slice(&information_extracted.to_bits().to_le_bytes());
        bytes.push(match crop_to_mask {
            None => 0,
            Some(false) => 1,
            Some(true) => 2,
        });
        for seed in [focus_seed, info_extract_seed] {
            bytes.push(u8::from(seed.is_some()));
            if let Some(seed) = seed {
                bytes.extend_from_slice(&seed.to_le_bytes());
            }
        }
        Ok(Some(Self(BlobId::for_bytes(&bytes))))
    }
}

/// A slot can reuse a completed encoding or follow matching queued/running work.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum VibeEncodingOutcome {
    Reused { asset_id: String },
    Queued { job: Box<JobRecord> },
}

impl JobQueue {
    /// Reuses encodings and unfinished work with the same normalized local inputs.
    /// # Errors
    /// Returns invalid input, unreadable media, missing credentials or storage failures.
    pub fn ensure_vibe_encoding(
        &self,
        input: crate::session::VibeEncodingInput,
        policy: novelai_bridge::ValidationPolicy,
    ) -> Result<VibeEncodingOutcome, JobError> {
        let draft = Draft {
            inputs: crate::session::CreationInputs {
                operation: crate::session::CreationOperation::EncodeVibe(input),
                policy,
                ..Default::default()
            },
            ..Default::default()
        };
        let submission = self.freeze(&draft)?;
        let key = self.encoding_key(&submission)?.ok_or_else(|| {
            PersistenceError::failure(
                "derive a frozen Vibe encoding identity",
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "encoding draft froze to another operation",
                ),
            )
        })?;
        // This same gate protects explicit submissions and retries. Keep lookup and
        // insertion together so concurrent clicks cannot create duplicate paid work.
        let _gate = self
            .submission_gate
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        // Read unfinished work first: it may complete while completed assets are
        // checked. Reading in the other order could miss it in both queries.
        let unfinished = self.store.unfinished_vibe_encoding(&key)?;
        for asset_id in self.store.vibe_encodings(&key)? {
            match self.assets.vibe(&asset_id) {
                Ok(_) => {
                    tracing::debug!(asset_id, "reused complete matching Vibe encoding");
                    return Ok(VibeEncodingOutcome::Reused { asset_id });
                },
                Err(error) => {
                    tracing::warn!(asset_id, error = %error, "matching Vibe encoding is unavailable; checking remaining matches");
                },
            }
        }
        if let Some(job) = unfinished {
            tracing::debug!(job_id = job.id, "joined matching unfinished Vibe encoding");
            return Ok(VibeEncodingOutcome::Queued { job: Box::new(job) });
        }
        let credential_id = self.clients.credential_id()?;
        self.check_credentials(&credential_id)?;
        let batch = self.enqueue_locked(
            &[submission],
            &[Some(key)],
            self.clients.execution_preferences()?,
            &credential_id,
            None,
        )?;
        let job = batch
            .jobs
            .into_iter()
            .next()
            .ok_or_else(|| PersistenceError::InvalidData {
                message: UserMessage::VibeJobMissing,
            })?;
        Ok(VibeEncodingOutcome::Queued { job: Box::new(job) })
    }

    pub(super) fn encoding_key(
        &self,
        submission: &FrozenSubmission,
    ) -> Result<Option<DerivationKey>, JobError> {
        DerivationKey::for_submission(submission, self.assets.as_ref())
    }
}

#[cfg(test)]
mod tests;

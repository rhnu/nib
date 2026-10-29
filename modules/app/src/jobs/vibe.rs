//! Complete known encoding inputs are matched independently of official opaque cache keys.
use serde::Serialize;

use super::{Draft, FrozenSubmission, JobError, JobQueue, JobRecord};
use crate::persistence::PersistenceError;

/// A slot can reuse a completed encoding or follow one newly queued encoding request.
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

pub struct VibeEncodingCandidate {
    pub submission: FrozenSubmission,
    pub asset_id: String,
}

impl JobQueue {
    /// Reuses only encodings whose complete normalized local inputs are known.
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
        for candidate in self.store.vibe_encodings()? {
            if !self.encoding_inputs_match(&submission, &candidate.submission)? {
                continue;
            }
            match self.assets.vibe(&candidate.asset_id) {
                Ok(_) => {
                    tracing::debug!(
                        asset_id = candidate.asset_id,
                        "reused complete matching Vibe encoding"
                    );
                    return Ok(VibeEncodingOutcome::Reused {
                        asset_id: candidate.asset_id,
                    });
                },
                Err(error) => {
                    tracing::warn!(asset_id = candidate.asset_id, error = %error, "matching Vibe encoding is unavailable; preparing a new encoding");
                },
            }
        }
        let credential_id = self.clients.credential_id()?;
        self.check_credentials(&credential_id)?;
        let batch = self.enqueue_with(
            &[submission],
            self.clients.execution_preferences()?,
            &credential_id,
            None,
        )?;
        let job = batch
            .jobs
            .into_iter()
            .next()
            .ok_or_else(|| PersistenceError::InvalidData {
                message: "任务存储未返回已提交的编码任务。".to_owned(),
            })?;
        Ok(VibeEncodingOutcome::Queued { job: Box::new(job) })
    }

    fn encoding_inputs_match(
        &self,
        left: &FrozenSubmission,
        right: &FrozenSubmission,
    ) -> Result<bool, JobError> {
        match (left, right) {
            (
                FrozenSubmission::EncodeVibe {
                    asset_id: a,
                    model: am,
                    information_extracted: ai,
                    mask_asset_id: ak,
                    crop_to_mask: ac,
                    focus_seed: af,
                    info_extract_seed: ae,
                    ..
                },
                FrozenSubmission::EncodeVibe {
                    asset_id: b,
                    model: bm,
                    information_extracted: bi,
                    mask_asset_id: bk,
                    crop_to_mask: bc,
                    focus_seed: bf,
                    info_extract_seed: be,
                    ..
                },
            ) => {
                if am.vibe_model_key() != bm.vibe_model_key()
                    || ai.to_bits() != bi.to_bits()
                    || ac != bc
                    || af != bf
                    || ae != be
                {
                    return Ok(false);
                }
                let masks_match = match (ak, bk) {
                    (None, None) => true,
                    (Some(a), Some(b)) => self.same_image(a, b)?,
                    _ => false,
                };
                Ok(masks_match && self.same_image(a, b)?)
            },
            _ => Ok(false),
        }
    }

    fn same_image(&self, a: &str, b: &str) -> Result<bool, JobError> {
        if a == b {
            return Ok(true);
        }
        let left = self
            .assets
            .image(a)
            .map_err(|source| JobError::InputMedia { source })?;
        match self.assets.image(b) {
            Ok(right) => Ok(left.as_bytes() == right.as_bytes()),
            Err(PersistenceError::NotFound { .. } | PersistenceError::InvalidData { .. }) => {
                Ok(false)
            },
            Err(source) => Err(JobError::InputMedia { source }),
        }
    }
}

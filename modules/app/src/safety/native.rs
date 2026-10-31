use std::{
    collections::BTreeMap,
    sync::{
        Arc, OnceLock,
        atomic::{AtomicU64, Ordering},
    },
};

use nib_image_analysis::{ImageAnalyzer, ModelIdentity, RawRatingScores, RawTag};

use super::{
    ExtractedTag, ImageAnalysisStatus, ImageSafetyScanner, ImageTags, RatingScores,
    SafetyAssessment, SafetyModelEvidence, SafetyReview, SafetyStatus, ScanOutcome, policy::policy,
};
use crate::{media::MediaLibrary, persistence::PersistenceError, settings::GlobalSettingsStore};

/// Applies the calibrated anime/optional WD cascade to installed model generations.
pub struct SafetyScanner {
    analyzer: Arc<ImageAnalyzer>,
    settings: Arc<GlobalSettingsStore>,
    preferences_epoch: AtomicU64,
}

impl SafetyScanner {
    pub fn new(analyzer: Arc<ImageAnalyzer>, settings: Arc<GlobalSettingsStore>) -> Self {
        Self {
            analyzer,
            settings,
            preferences_epoch: AtomicU64::new(0),
        }
    }

    /// Makes a saved automatic setting change visible even between background polls.
    pub fn preferences_changed(&self) { self.preferences_epoch.fetch_add(1, Ordering::Relaxed); }

    /// Reports installed capabilities without requiring credentials or opening image storage.
    /// # Errors
    /// Returns shared model state failures.
    pub fn status(&self) -> Result<ImageAnalysisStatus, PersistenceError> {
        let anime = self
            .analyzer
            .anime_identity()
            .map_err(|error| PersistenceError::failure("read anime model identity", error))?;
        let wd = self
            .analyzer
            .wd_identity()
            .map_err(|error| PersistenceError::failure("read WD model identity", error))?;
        Ok(ImageAnalysisStatus {
            anime_available: anime.is_some(),
            wd_available: wd.is_some(),
            anime_version: anime.map(|model| model.version),
            wd_version: wd.map(|model| model.version),
        })
    }

    /// Model identities and automatic preferences determine when unknown history is revisited.
    /// # Errors
    /// Returns configuration or inference state failures.
    pub fn automatic_revision(&self) -> Result<String, PersistenceError> {
        let preferences = self.settings.preferences()?.safety;
        Ok(format!(
            "{}:{}:{}:{:?}:{:?}",
            self.preferences_epoch.load(Ordering::Relaxed),
            preferences.auto_scan,
            preferences.use_wd_review,
            self.analyzer
                .anime_identity()
                .map_err(|error| PersistenceError::failure("read anime model identity", error))?,
            self.analyzer
                .wd_identity()
                .map_err(|error| PersistenceError::failure("read WD model identity", error))?
        ))
    }

    /// Extracts WD ordinary and character tags independently from automatic rating preferences.
    /// # Errors
    /// Returns invalid thresholds, unavailable models or media/model failures.
    pub fn extract_tags(
        &self,
        media: &MediaLibrary,
        asset_id: &str,
        general_threshold: f32,
        character_threshold: f32,
    ) -> Result<ImageTags, PersistenceError> {
        if ![general_threshold, character_threshold]
            .into_iter()
            .all(|value| value.is_finite() && (0.0..=1.0).contains(&value))
        {
            return Err(PersistenceError::InvalidData {
                message: crate::api::UserMessage::external(
                    "Tag thresholds must be finite values between zero and one.",
                ),
            });
        }
        let asset = media.asset(asset_id)?;
        if asset.kind != crate::media::AssetKind::Image {
            return Err(PersistenceError::InvalidData {
                message: crate::api::UserMessage::VibeIsNotImage,
            });
        }
        // Analysis accepts owned covers too; retained content still verifies length and digest.
        let image = media.read_asset(asset_id)?;
        let (analysis, identity) = self
            .analyzer
            .wd_analysis(&image.bytes)
            .map_err(|error| PersistenceError::failure("extract WD image tags", error))?;
        Ok(ImageTags {
            general: select_tags(analysis.general, general_threshold),
            characters: select_tags(analysis.characters, character_threshold),
            model_version: format!("{}@{}", identity.version, identity.revision),
        })
    }
}

impl ImageSafetyScanner for SafetyScanner {
    fn scan(&self, bytes: &[u8], manual: bool) -> Result<ScanOutcome, PersistenceError> {
        let preferences = self.settings.preferences()?.safety;
        if !manual && !preferences.auto_scan {
            return Ok(ScanOutcome::unknown("autoScanDisabled"));
        }
        let policy = policy();
        let (ratings, identity) = match self.analyzer.anime_scores(bytes) {
            Ok(result) => result,
            Err(error) => {
                let reason = if matches!(error, nib_image_analysis::AnalysisError::Unavailable(_)) {
                    "modelUnavailable".to_owned()
                } else {
                    tracing::warn!(error=?error, "primary image safety inference failed");
                    format!("analysisFailed: {}", crate::api::error_detail(&error))
                };
                return Ok(ScanOutcome::unknown(reason));
            },
        };
        if identity.revision != policy.primary_model_revision {
            return Ok(ScanOutcome::unknown("modelRevisionMismatch"));
        }
        let ratings = rating_scores(ratings);
        let primary_score = policy.primary_score(ratings);
        let primary = evidence("anime-dbrating", identity, ratings, primary_score);
        let (status, review) = if primary_score >= policy.primary_threshold {
            (SafetyStatus::Nsfw, SafetyReview::NotNeeded)
        } else if !policy.should_review(primary_score) {
            (SafetyStatus::Safe, SafetyReview::NotNeeded)
        } else if !preferences.use_wd_review
            || self
                .analyzer
                .wd_identity()
                .map_err(|error| PersistenceError::failure("read WD review availability", error))?
                .is_none()
        {
            (SafetyStatus::Safe, SafetyReview::Disabled)
        } else {
            match self.analyzer.wd_scores(bytes) {
                Ok((ratings, identity)) if identity.revision == policy.review_model_revision => {
                    let ratings = rating_scores(ratings);
                    let score = policy.review_score(ratings);
                    (
                        if score >= policy.review_threshold {
                            SafetyStatus::Nsfw
                        } else {
                            SafetyStatus::Safe
                        },
                        SafetyReview::Completed {
                            evidence: evidence("wd-swinv2-tagger-v3", identity, ratings, score),
                        },
                    )
                },
                result => {
                    let message = match result {
                        Err(error) => crate::api::error_detail(&error),
                        Ok(_) => {
                            "WD model revision does not match the calibrated policy".to_owned()
                        },
                    };
                    tracing::warn!(
                        message,
                        "optional image safety review failed; retaining sensitive decision"
                    );
                    (
                        SafetyStatus::Nsfw,
                        SafetyReview::Failed {
                            model_revision: policy.review_model_revision.clone(),
                            message,
                        },
                    )
                },
            }
        };
        tracing::debug!(
            ?status,
            primary_score,
            "completed local image safety assessment"
        );
        Ok(ScanOutcome {
            status,
            reason: None,
            assessment: Some(SafetyAssessment {
                status,
                policy_id: policy.id.clone(),
                policy_version: policy.version.clone(),
                primary,
                review,
                assessed_at: crate::jobs::timestamp()?,
            }),
        })
    }
}

fn rating_scores(raw: RawRatingScores) -> RatingScores {
    RatingScores {
        general: raw.general,
        sensitive: raw.sensitive,
        questionable: raw.questionable,
        explicit: raw.explicit,
    }
}

fn evidence(
    model_id: &str,
    model: ModelIdentity,
    ratings: RatingScores,
    fused_score: f32,
) -> SafetyModelEvidence {
    SafetyModelEvidence {
        model_id: model_id.to_owned(),
        model_version: model.version,
        model_revision: model.revision,
        generation: model.generation,
        ratings,
        fused_score,
    }
}

fn select_tags(tags: Vec<RawTag>, threshold: f32) -> Vec<ExtractedTag> {
    let overrides = prompt_overrides();
    let mut tags: Vec<_> = tags
        .into_iter()
        .filter(|tag| tag.confidence >= threshold)
        .map(|tag| ExtractedTag {
            prompt_text: overrides
                .get(&tag.name)
                .cloned()
                .unwrap_or_else(|| tag.name.replace('_', " ")),
            name: tag.name,
            confidence: tag.confidence,
        })
        .collect();
    tags.sort_by(|left, right| {
        right
            .confidence
            .total_cmp(&left.confidence)
            .then_with(|| left.name.cmp(&right.name))
    });
    tags
}

fn prompt_overrides() -> &'static BTreeMap<String, String> {
    #[derive(serde::Deserialize)]
    struct NovelAiTags {
        overrides: BTreeMap<String, String>,
    }
    static OVERRIDES: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    OVERRIDES.get_or_init(|| {
        serde_json::from_str::<NovelAiTags>(include_str!(
            "../../../../resources/lexicon/novelai.json"
        ))
        .expect("the checked-in NovelAI tag mapping is valid")
        .overrides
    })
}

#[cfg(test)]
mod tests;

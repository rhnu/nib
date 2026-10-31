use std::sync::OnceLock;

use super::RatingScores;

/// Production calibration is shared with the validated Atelier cascade.
#[derive(serde::Deserialize)]
pub(super) struct Policy {
    pub id: String,
    pub version: String,
    pub primary_model_revision: String,
    pub review_model_revision: String,
    primary_intercept: f32,
    primary_coefficients: [f32; 4],
    pub primary_threshold: f32,
    pub review_margin: f32,
    review_intercept: f32,
    review_coefficients: [f32; 4],
    pub review_threshold: f32,
}

impl Policy {
    pub fn primary_score(&self, scores: RatingScores) -> f32 {
        logistic(scores, self.primary_intercept, self.primary_coefficients)
    }

    pub fn review_score(&self, scores: RatingScores) -> f32 {
        logistic(scores, self.review_intercept, self.review_coefficients)
    }

    pub fn should_review(&self, score: f32) -> bool {
        (self.primary_threshold - self.review_margin..self.primary_threshold).contains(&score)
    }
}

pub(super) fn policy() -> &'static Policy {
    static POLICY: OnceLock<Policy> = OnceLock::new();
    POLICY.get_or_init(|| {
        serde_json::from_str(include_str!("anime-rating-cascade-v1.json"))
            .expect("the checked-in safety policy is valid")
    })
}

fn logistic(scores: RatingScores, intercept: f32, coefficients: [f32; 4]) -> f32 {
    let logit = [
        scores.general,
        scores.sensitive,
        scores.questionable,
        scores.explicit,
    ]
    .into_iter()
    .zip(coefficients)
    .fold(intercept, |sum, (score, coefficient)| {
        score.mul_add(coefficient, sum)
    });
    1.0 / (1.0 + (-logit).exp())
}

#[cfg(test)]
mod tests;

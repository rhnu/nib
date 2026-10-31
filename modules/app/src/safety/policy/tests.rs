use super::*;

#[test]
fn calibrated_ratings_separate_general_and_explicit_images() {
    let policy = policy();
    let general = RatingScores {
        general: 1.0,
        sensitive: 0.0,
        questionable: 0.0,
        explicit: 0.0,
    };
    let explicit = RatingScores {
        general: 0.0,
        sensitive: 0.0,
        questionable: 0.0,
        explicit: 1.0,
    };
    assert!(policy.primary_score(general) < policy.primary_threshold - policy.review_margin);
    assert!(policy.primary_score(explicit) >= policy.primary_threshold);
    assert!(policy.review_score(general) < policy.review_threshold);
    assert!(policy.review_score(explicit) >= policy.review_threshold);
}

#[test]
fn optional_review_only_covers_the_band_below_the_primary_threshold() {
    let policy = policy();
    assert!(policy.should_review(policy.primary_threshold - policy.review_margin));
    assert!(policy.should_review(policy.primary_threshold - policy.review_margin / 2.0));
    assert!(!policy.should_review(policy.primary_threshold));
    assert!(!policy.should_review(policy.primary_threshold - policy.review_margin * 2.0));
    assert_eq!(policy.id, "anime-rating-cascade");
    assert_eq!(policy.version, "1");
    assert_ne!(policy.primary_model_revision, "");
    assert_ne!(policy.review_model_revision, "");
}

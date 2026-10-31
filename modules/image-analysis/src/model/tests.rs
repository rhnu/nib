use super::{normalize_probabilities, read_wd_metadata};
use crate::AnalysisError;

#[test]
fn wd_metadata_keeps_csv_output_order_and_categories() {
    let csv = b"tag_id,name,category,count\n1,one_girl,0,1\n2,explicit,9,1\n3,a_character,4,1\n4,general,9,1\n5,questionable,9,1\n6,sensitive,9,1\n";
    let metadata = read_wd_metadata(csv.as_slice()).unwrap();
    assert_eq!(metadata.rating_indices, [3, 5, 4, 1]);
    assert_eq!(metadata.count, 6);
    assert_eq!(metadata.tags.len(), 2);
    assert_eq!(metadata.tags[0].index, 0);
    assert!(!metadata.tags[0].character);
    assert_eq!(metadata.tags[1].index, 2);
    assert!(metadata.tags[1].character);
}

#[test]
fn wd_metadata_rejects_missing_and_duplicate_ratings() {
    let missing = b"name,category\ngeneral,9\n";
    assert!(matches!(
        read_wd_metadata(missing.as_slice()),
        Err(AnalysisError::InvalidResource(_))
    ));
    let duplicate =
        b"name,category\ngeneral,9\ngeneral,9\nsensitive,9\nquestionable,9\nexplicit,9\n";
    assert!(matches!(
        read_wd_metadata(duplicate.as_slice()),
        Err(AnalysisError::InvalidResource(_))
    ));
}

#[test]
fn nonfinite_scores_never_turn_into_safe_probabilities() {
    for score in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        assert!(matches!(
            normalize_probabilities(&mut [score]),
            Err(AnalysisError::InvalidOutput(_))
        ));
    }
}

#[test]
fn finite_scores_are_clamped_to_probability_bounds() {
    let mut values = [-0.1, 0.0, 0.5, 1.0, 1.1];
    normalize_probabilities(&mut values).unwrap();
    assert_eq!(values, [0.0, 0.0, 0.5, 1.0, 1.0]);
}

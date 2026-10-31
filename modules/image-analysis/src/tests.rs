use super::{ANIME_RESOURCE_ID, AnalysisError, ImageAnalyzer, WD_RESOURCE_ID};

#[test]
fn missing_resources_report_unavailable_before_attempting_decode() {
    let analyzer = ImageAnalyzer::default();
    assert!(analyzer.anime_identity().unwrap().is_none());
    assert!(analyzer.wd_identity().unwrap().is_none());
    assert!(matches!(
        analyzer.anime_scores(b"invalid"),
        Err(AnalysisError::Unavailable(ANIME_RESOURCE_ID))
    ));
    assert!(matches!(
        analyzer.wd_scores(b"invalid"),
        Err(AnalysisError::Unavailable(WD_RESOURCE_ID))
    ));
    assert!(matches!(
        analyzer.wd_analysis(b"invalid"),
        Err(AnalysisError::Unavailable(WD_RESOURCE_ID))
    ));
}

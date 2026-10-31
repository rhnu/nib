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

#[test]
fn recovery_status_distinguishes_missing_loading_failed_and_removed_models() {
    let analyzer = ImageAnalyzer::default();
    let consumer = analyzer.anime_consumer();
    let missing = analyzer.anime_status().unwrap();
    assert!(missing.identity.is_none());
    assert!(!missing.loading);
    assert!(missing.error.is_none());

    consumer.restore_started();
    let loading = analyzer.anime_status().unwrap();
    assert!(loading.loading);
    assert!(loading.identity.is_none());

    consumer.restore_failed("damaged resource");
    let failed = analyzer.anime_status().unwrap();
    assert!(!failed.loading);
    assert!(failed.error.is_some());

    consumer.deactivate();
    let removed = analyzer.anime_status().unwrap();
    assert!(!removed.loading);
    assert!(removed.error.is_none());
    assert!(removed.identity.is_none());
}

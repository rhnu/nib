use super::*;

#[test]
fn settlement_keeps_sdk_failure_category_without_provider_payloads() {
    assert_eq!(
        RequestSettlement::from(RequestOutcome::Failed {
            failure: RequestFailure::Api { status: 429 }
        }),
        RequestSettlement::Failed {
            failure: "api".to_owned(),
            http_status: Some(429)
        }
    );
    assert_eq!(
        RequestSettlement::from(RequestOutcome::Cancelled),
        RequestSettlement::Cancelled
    );
}

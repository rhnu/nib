use novelai_bridge::{ApiError, ApiErrorReason};

use super::*;
use crate::api::UserMessage;

fn identity(credential: &str, endpoint: &str) -> (String, String) {
    (credential.to_owned(), endpoint.to_owned())
}

fn subscription(balance: i64) -> SubscriptionInfo {
    SubscriptionInfo {
        anlas_balance: balance,
        subscription_active: true,
        tier: 1,
        expires_at_ms: None,
        v5_usage: None,
        raw_response: serde_json::Value::Null,
    }
}

#[test]
fn returning_to_an_identity_rejects_its_previous_refresh() {
    let first = identity("first", "endpoint");
    let mut state = SamplingState::default();
    state.synchronize_identity(Some(first.clone()));
    let old_epoch = state.begin_refresh(false, 100).unwrap();
    state.synchronize_identity(Some(identity("second", "endpoint")));
    state.synchronize_identity(Some(first.clone()));
    let current_epoch = state.begin_refresh(false, 200).unwrap();
    let revision = state.snapshot.revision;

    assert_eq!(
        state.complete_refresh(Some(&first), &first, old_epoch, Ok(subscription(12)), 300),
        None
    );
    assert!(state.snapshot.refreshing);
    assert!(state.snapshot.summary.is_none());
    assert_eq!(state.snapshot.revision, revision);
    assert_eq!(
        state.complete_refresh(
            Some(&first),
            &first,
            current_epoch,
            Ok(subscription(34)),
            400
        ),
        Some(false)
    );
    assert_eq!(state.snapshot.summary.unwrap().anlas_balance, 34);
}

#[test]
fn changed_active_endpoint_rejects_a_response_before_state_is_synchronized() {
    let previous = identity("account", "previous");
    let current = identity("account", "current");
    let mut state = SamplingState::default();
    state.synchronize_identity(Some(previous.clone()));
    let epoch = state.begin_refresh(false, 100).unwrap();

    assert_eq!(
        state.complete_refresh(Some(&current), &previous, epoch, Ok(subscription(12)), 200),
        None
    );
    assert!(state.snapshot.summary.is_none());
}

#[test]
fn repeated_forced_triggers_request_one_followup_sample() {
    let account = identity("account", "endpoint");
    let mut state = SamplingState::default();
    state.synchronize_identity(Some(account.clone()));
    let epoch = state.begin_refresh(false, 100).unwrap();
    assert!(state.begin_refresh(false, 101).is_none());
    assert!(state.begin_refresh(true, 102).is_none());
    assert!(state.begin_refresh(true, 103).is_none());
    assert_eq!(
        state.complete_refresh(Some(&account), &account, epoch, Ok(subscription(12)), 200),
        Some(true)
    );
    let epoch = state.begin_refresh(true, 201).unwrap();
    assert_eq!(
        state.complete_refresh(Some(&account), &account, epoch, Ok(subscription(12)), 300),
        Some(false)
    );
    assert!(!state.snapshot.refreshing);
}

#[test]
fn failed_refresh_preserves_the_last_sample_and_redacts_provider_details() {
    let account = identity("account", "endpoint");
    let mut state = SamplingState::default();
    state.synchronize_identity(Some(account.clone()));
    let epoch = state.begin_refresh(false, 100).unwrap();
    state.complete_refresh(Some(&account), &account, epoch, Ok(subscription(12)), 200);
    let summary = state.snapshot.summary.clone();
    let epoch = state.begin_refresh(true, 300).unwrap();
    let error = ApiError::from_response_parts(
        401,
        "https://provider.invalid/user/subscription",
        None,
        Some(ApiErrorReason::Message("secret-provider-echo".to_owned())),
        Some("secret-body".to_owned()),
        false,
    );
    state.complete_refresh(Some(&account), &account, epoch, Err(error.into()), 400);

    assert_eq!(state.snapshot.summary, summary);
    assert_eq!(state.sample.as_ref().unwrap().sampled_at, 200);
    assert_eq!(
        state.snapshot.error,
        Some(UserMessage::ProviderHttpFailure { status: 401 })
    );
    assert!(state.snapshot.stale);
    assert!(!state.snapshot.refreshing);

    let epoch = state.begin_refresh(true, 500).unwrap();
    state.complete_refresh(Some(&account), &account, epoch, Ok(subscription(34)), 600);
    assert!(!state.snapshot.stale);
    assert!(state.snapshot.error.is_none());
    assert_eq!(state.snapshot.summary.unwrap().anlas_balance, 34);
}

#[test]
fn fresh_samples_wait_until_expiry() {
    let account = identity("account", "endpoint");
    let mut state = SamplingState::default();
    state.synchronize_identity(Some(account.clone()));
    let epoch = state.begin_refresh(false, 100).unwrap();
    state.complete_refresh(Some(&account), &account, epoch, Ok(subscription(12)), 200);

    assert!(state.begin_refresh(false, 60_199).is_none());
    assert!(state.begin_refresh(false, 60_200).is_some());
    assert!(state.snapshot.stale);
    assert!(state.snapshot.refreshing);
}

#[test]
fn changed_identity_clears_the_previous_account_sample() {
    let account = identity("account", "endpoint");
    let mut state = SamplingState::default();
    state.synchronize_identity(Some(account.clone()));
    let epoch = state.begin_refresh(false, 100).unwrap();
    state.complete_refresh(Some(&account), &account, epoch, Ok(subscription(12)), 200);
    assert!(state.begin_refresh(true, 300).is_some());
    assert!(state.begin_refresh(true, 301).is_none());

    state.synchronize_identity(Some(identity("account", "different-endpoint")));
    assert!(state.snapshot.summary.is_none());
    assert!(state.sample.is_none());
    assert!(!state.snapshot.refreshing);
    assert!(!state.refresh_pending);
    assert!(state.begin_refresh(false, 302).is_some());
}

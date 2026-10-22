use super::*;

#[test]
fn request_policy_controls_sdk_rejection_and_survives_frozen_input_roundtrip() {
    use novelai_bridge::{
        BridgeError, GenerationField, InvalidRequest, RequestField, ValidationPolicy,
    };
    let mut resolved = submission().resolved().unwrap().clone();
    resolved.positive = "cat".into();
    resolved.negative = "blurry".into();
    resolved.settings.steps = 0;
    resolved.settings.seed = 0;
    resolved.settings.furry_mode = false;
    resolved.inputs.policy = ValidationPolicy::Reject;
    assert!(matches!(
        prepare_submission(resolved.clone(), &NoAssets),
        Err(JobError::Bridge(BridgeError::InvalidRequest(
            InvalidRequest::NumericOutOfRange {
                field: RequestField::Generation(GenerationField::Steps),
                ..
            }
        )))
    ));
    resolved.inputs.policy = ValidationPolicy::Normalize;
    let frozen = prepare_submission(resolved, &NoAssets).unwrap();
    let reopened = sqlite::decode_submission(&sqlite::encode_submission(&frozen).unwrap()).unwrap();
    assert_eq!(frozen, reopened);
    assert!(!reopened.resolved().unwrap().settings.furry_mode);
    assert!(
        reopened
            .diagnostics()
            .iter()
            .any(|diagnostic| diagnostic.field == "sampling.steps")
    );
    assert_eq!(request(&reopened).policy, ValidationPolicy::Normalize);
    assert_eq!(
        reopened.resolved().unwrap().inputs.policy,
        ValidationPolicy::Normalize
    );
    let mut resolved = reopened.resolved().unwrap().clone();
    resolved.positive = "cat".into();
    resolved.negative = "blurry".into();
    resolved.inputs.policy = ValidationPolicy::Reject;
    let strict = prepare_submission(resolved, &NoAssets).unwrap();
    let strict = sqlite::decode_submission(&sqlite::encode_submission(&strict).unwrap()).unwrap();
    assert_eq!(request(&strict).policy, ValidationPolicy::Reject);
    let restored = crate::session::restore_generation(
        request(&strict),
        strict.resolved().unwrap().inputs.clone(),
    );
    assert_eq!(restored.inputs.policy, ValidationPolicy::Reject);
}

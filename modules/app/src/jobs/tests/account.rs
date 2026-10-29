//! Account snapshots remain consistent when pricing and observing requests.

use super::*;

pub(super) fn sampled_account(sampled_at: i64) -> crate::settings::AccountSample {
    crate::settings::AccountSample {
        subscription: novelai_bridge::SubscriptionInfo {
            anlas_balance: 10,
            subscription_active: true,
            tier: 3,
            expires_at_ms: None,
            v5_usage: None,
            raw_response: serde_json::Value::Null,
        },
        sampled_at,
    }
}

#[test]
fn quote_uses_one_immutable_account_sample_for_price_and_timestamp() {
    struct SampledProvider(Arc<std::sync::atomic::AtomicUsize>);
    impl SdkClientProvider for SampledProvider {
        fn credential_id(&self) -> Result<String, JobError> { Err(JobError::MissingCredentials) }

        fn client(&self) -> Result<SdkClient, JobError> { Err(JobError::MissingCredentials) }

        fn account_sample(&self) -> Option<crate::settings::AccountSample> {
            Some(sampled_account(
                i64::try_from(self.0.fetch_add(1, Ordering::Relaxed))
                    .expect("the unit test sample count fits in i64")
                    + 1,
            ))
        }
    }
    let reads = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (mut queue, _) = memory_queue(Arc::new(MemoryJobs::default()), false);
    let mutable = Arc::get_mut(&mut queue).unwrap();
    mutable.assets = Arc::new(ImageAssets);
    mutable.clients = Arc::new(SampledProvider(Arc::clone(&reads)));
    let mut draft = Draft::default();
    draft.inputs.operation = crate::session::CreationOperation::Director {
        asset_id: "source".to_owned(),
        command: novelai_bridge::DirectorCommand::Lineart,
    };
    let quote = queue.quote(&draft).unwrap();
    let expected = novelai_bridge::RunDirectorToolRequest {
        image: ImageAssets.image("source").unwrap(),
        command: novelai_bridge::DirectorCommand::Lineart,
        policy: draft.inputs.policy,
    }
    .prepare()
    .unwrap()
    .estimate_anlas_cost(novelai_bridge::AnlasPricingContext::from(
        &sampled_account(1).subscription,
    ));
    assert_eq!(reads.load(Ordering::Relaxed), 1);
    assert_eq!(quote.account_sampled_at, Some(1));
    assert_eq!(quote.estimated_anlas, Some(expected));
    assert!(quote.account_specific);
}

#[test]
fn account_summary_serialization_excludes_original_response() {
    let info = novelai_bridge::SubscriptionInfo {
        anlas_balance: 10,
        subscription_active: true,
        tier: 3,
        expires_at_ms: None,
        v5_usage: None,
        raw_response: serde_json::json!({"private_payment_data":"secret"}),
    };
    let encoded = serde_json::to_string(&crate::settings::AccountSummary::from(&info)).unwrap();
    assert!(!encoded.contains("secret"));
    assert!(!encoded.contains("private_payment_data"));
    assert!(!encoded.contains("raw_response"));
}

#[test]
fn quote_without_credentials_counts_each_prompt_target_locally() {
    let (mut queue, unexpected_call) = memory_queue(Arc::new(MemoryJobs::default()), false);
    Arc::get_mut(&mut queue).unwrap().tokenizers = Arc::new(Tokenizers::bundled().unwrap());
    let draft = Draft {
        composition: Composition {
            positive: vec![PromptNode::Text {
                id: "p".to_owned(),
                enabled: true,
                text: "a cat".to_owned(),
            }],
            negative: vec![PromptNode::Text {
                id: "n".to_owned(),
                enabled: true,
                text: "blurry".to_owned(),
            }],
        },
        ..Draft::default()
    };
    let quote = queue.quote(&draft).unwrap();
    assert_eq!(quote.tokens.len(), 2);
    assert!(
        quote
            .tokens
            .iter()
            .all(|count| count.used > 0 && count.limit > 0)
    );
    assert!(!quote.account_specific);
    assert!(quote.account_sampled_at.is_none());
    assert!(!unexpected_call.load(Ordering::Acquire));
}

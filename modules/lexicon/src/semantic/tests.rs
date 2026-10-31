use std::sync::atomic::AtomicUsize;

use super::*;

#[test]
fn disabled_semantics_never_call_the_loader() {
    let control = SemanticControl::new(false);
    let slot = control.slot();
    let called = AtomicUsize::new(0);
    if let Some(runtime) = control.runtime(&slot, control.status().1) {
        assert!(
            runtime
                .initialize(|| {
                    called.fetch_add(1, Ordering::Relaxed);
                    Err(anyhow::anyhow!("not loaded"))
                })
                .is_err()
        );
    }
    assert_eq!(called.load(Ordering::Relaxed), 0);
}

#[test]
fn disabling_retires_contexts_and_prevents_the_next_stage() {
    let control = SemanticControl::new(true);
    let slot = control.slot();
    let initial_revision = control.status().1;
    let runtime = control.runtime(&slot, initial_revision).unwrap();
    let retired = Arc::downgrade(&runtime);
    assert!(Arc::ptr_eq(
        &runtime,
        &control.runtime(&slot, initial_revision).unwrap()
    ));
    control.set_enabled(false);
    assert!(!runtime.active());
    let called = AtomicUsize::new(0);
    assert!(
        runtime
            .initialize(|| {
                called.fetch_add(1, Ordering::Relaxed);
                Err(anyhow::anyhow!("cancelled context started another stage"))
            })
            .unwrap()
            .is_none()
    );
    assert_eq!(called.load(Ordering::Relaxed), 0);
    assert!(control.runtime(&slot, control.status().1).is_none());
    assert!(retired.upgrade().is_some());
    drop(runtime);
    assert!(retired.upgrade().is_none());
}

#[test]
fn late_loader_failures_are_discarded_after_disable_and_reenable() {
    let control = SemanticControl::new(true);
    let slot = control.slot();
    let initial_revision = control.status().1;
    let runtime = control.runtime(&slot, initial_revision).unwrap();
    let result = runtime
        .initialize(|| {
            control.set_enabled(false);
            control.set_enabled(true);
            Err(anyhow::anyhow!("obsolete operation failed"))
        })
        .unwrap();
    assert!(result.is_none());
    assert!(!runtime.active());
    assert!(control.runtime(&slot, initial_revision).is_none());
    let replacement = control.runtime(&slot, control.status().1).unwrap();
    assert!(!Arc::ptr_eq(&runtime, &replacement));
    assert!(replacement.active());
}

#[test]
fn semantic_failures_are_cached_until_the_context_is_replaced() {
    let control = SemanticControl::new(true);
    let slot = control.slot();
    let runtime = control.runtime(&slot, control.status().1).unwrap();
    let called = AtomicUsize::new(0);
    for _ in 0..2 {
        assert!(
            runtime
                .initialize(|| {
                    called.fetch_add(1, Ordering::Relaxed);
                    Err(anyhow::anyhow!("invalid semantic resource"))
                })
                .is_err()
        );
    }
    assert_eq!(called.load(Ordering::Relaxed), 1);
    control.set_enabled(false);
    control.set_enabled(true);
    let replacement = control.runtime(&slot, control.status().1).unwrap();
    assert!(
        replacement
            .initialize(|| {
                called.fetch_add(1, Ordering::Relaxed);
                Err(anyhow::anyhow!("new initialization"))
            })
            .is_err()
    );
    assert_eq!(called.load(Ordering::Relaxed), 2);
}

#[test]
fn semantic_control_does_not_keep_expired_generation_slots_alive() {
    let control = SemanticControl::new(true);
    let slot = control.slot();
    let expired = Arc::downgrade(&slot);
    drop(slot);
    let replacement = control.slot();
    assert!(expired.upgrade().is_none());
    control.set_enabled(false);
    assert!(expired.upgrade().is_none());
    assert!(control.runtime(&replacement, control.status().1).is_none());
}

#[test]
fn indexed_categories_follow_keys_instead_of_database_order() {
    let keys = vec!["second".into(), "first".into()];
    let kinds = indexed_kinds(
        &keys,
        [
            Ok(("first".into(), "artist".into())),
            Ok(("unindexed".into(), "unsupported".into())),
            Ok(("second".into(), "character".into())),
        ],
    )
    .unwrap();
    assert_eq!(kinds.len(), 2);
    assert_eq!(kinds["first"], LexiconKind::Artist);
    assert_eq!(kinds["second"], LexiconKind::Character);
}

#[test]
fn indexed_categories_reject_missing_and_invalid_terms() {
    let keys = vec!["first".into()];
    assert!(indexed_kinds(&keys, []).is_err());
    assert!(indexed_kinds(&keys, [Ok(("first".into(), "unsupported".into()))]).is_err());
    assert!(indexed_kinds(&keys, [Err(rusqlite::Error::InvalidQuery)]).is_err());
}

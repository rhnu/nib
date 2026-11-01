use super::*;

#[test]
fn stopping_before_claim_cancels_the_entire_batch_and_preserves_other_work() {
    let store = Arc::new(MemoryJobs::default());
    let (queue, _) = memory_queue(Arc::clone(&store), true);
    let frozen = submission();
    let batch = queue
        .enqueue_with(
            &[frozen.clone(), frozen.clone()],
            ExecutionPreferences::default(),
            "test-account",
            None,
        )
        .unwrap();
    let other = queue.enqueue(&frozen).unwrap();
    let snapshot = queue.cancel_batch(&batch.batch_id).unwrap();
    assert!(
        snapshot
            .iter()
            .all(|job| job.status == JobStatus::Cancelled)
    );
    assert_eq!(queue.cancel_batch(&batch.batch_id).unwrap(), snapshot);
    assert_eq!(store.claim_job().unwrap().unwrap().id, other.id);
    assert_eq!(queue.cancel(&other.id).unwrap().status, JobStatus::Running);
}

#[test]
fn stopping_after_claim_preserves_running_and_terminal_states() {
    let store = Arc::new(MemoryJobs::default());
    let (queue, _) = memory_queue(Arc::clone(&store), true);
    let frozen = submission();
    let batch = queue
        .enqueue_with(
            &[frozen.clone(), frozen],
            ExecutionPreferences::default(),
            "test-account",
            None,
        )
        .unwrap();
    let first = store.claim_job().unwrap().unwrap();
    let snapshot = queue.cancel_batch(&batch.batch_id).unwrap();
    assert_eq!(snapshot[0].status, JobStatus::Running);
    assert_eq!(snapshot[1].status, JobStatus::Cancelled);
    store
        .fail_job(&first.id, &UserMessage::ExecutionInterrupted)
        .unwrap();
    assert_eq!(queue.cancel(&first.id).unwrap().status, JobStatus::Failed);
    assert_eq!(
        queue.cancel_batch(&batch.batch_id).unwrap()[0].status,
        JobStatus::Failed
    );
    assert!(store.claim_job().unwrap().is_none());
    assert!(matches!(
        queue.cancel_batch("missing"),
        Err(JobError::Persistence(PersistenceError::NotFound { .. }))
    ));
}

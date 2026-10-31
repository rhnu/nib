use super::*;

#[test]
fn waits_for_all_requests_and_deduplicates_terminal_updates() {
    let mut batches = Batches::default();
    assert!(
        batches
            .observe_status("batch", "one", 2, JobStatus::Completed)
            .is_none()
    );
    assert!(
        batches
            .observe_status("batch", "two", 2, JobStatus::Running)
            .is_none()
    );
    let notice = batches
        .observe_status("batch", "two", 2, JobStatus::Failed)
        .unwrap();
    assert_eq!(
        (notice.completed, notice.failed, notice.cancelled),
        (1, 1, 0)
    );
    assert!(
        batches
            .observe_status("batch", "two", 2, JobStatus::Failed)
            .is_none()
    );
}

#[test]
fn all_cancelled_is_silent_and_interrupted_counts_as_failure() {
    let mut batches = Batches::default();
    assert!(
        batches
            .observe_status("cancelled", "one", 1, JobStatus::Cancelled)
            .is_none()
    );
    let notice = batches
        .observe_status("interrupted", "two", 1, JobStatus::Interrupted)
        .unwrap();
    assert_eq!((notice.completed, notice.failed), (0, 1));
}

#[test]
fn mixed_cancellation_and_success_reports_once() {
    let mut batches = Batches::default();
    assert!(
        batches
            .observe_status("batch", "one", 2, JobStatus::Cancelled)
            .is_none()
    );
    let notice = batches
        .observe_status("batch", "two", 2, JobStatus::Completed)
        .unwrap();
    assert_eq!(
        (notice.completed, notice.failed, notice.cancelled),
        (1, 0, 1)
    );
}

use super::*;

fn pending() -> (
    Option<PendingApproval>,
    tokio::sync::oneshot::Receiver<bool>,
) {
    let (decision, receiver) = tokio::sync::oneshot::channel();
    (
        Some(PendingApproval {
            id: "current".into(),
            decision,
        }),
        receiver,
    )
}

#[test]
fn a_decision_applies_once_to_the_matching_request() {
    for allow in [true, false] {
        let (mut slot, mut receiver) = pending();
        PendingApproval::take(&mut slot, "current", false)
            .unwrap()
            .decision
            .send(allow)
            .unwrap();
        assert_eq!(receiver.try_recv().unwrap(), allow);
        assert!(PendingApproval::take(&mut slot, "current", false).is_err());
    }
}

#[test]
fn stale_or_cancelled_decisions_cannot_consume_an_approval() {
    let (mut slot, mut receiver) = pending();
    assert!(PendingApproval::take(&mut slot, "old", false).is_err());
    assert!(PendingApproval::take(&mut slot, "current", true).is_err());
    assert!(receiver.try_recv().is_err());
    PendingApproval::take(&mut slot, "current", false)
        .unwrap()
        .decision
        .send(true)
        .unwrap();
    assert!(receiver.try_recv().unwrap());
}

#[test]
fn tightened_permissions_block_an_unapproved_submission() {
    assert!(authorize_submission(AgentPermission::Allow, false).is_ok());
    assert!(authorize_submission(AgentPermission::Ask, false).is_err());
    assert!(authorize_submission(AgentPermission::Ask, true).is_ok());
    assert!(authorize_submission(AgentPermission::Deny, true).is_err());
    assert!(authorize_submission(AgentPermission::Deny, false).is_err());
}

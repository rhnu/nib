use std::cell::{Cell, RefCell};

use super::*;
use crate::session::ActivePage;

#[derive(Default)]
struct MemoryStore {
    draft: RefCell<Draft>,
    fail_save: Cell<bool>,
}

impl DraftStore for MemoryStore {
    fn get_draft(&self) -> Result<Draft, PersistenceError> { Ok(self.draft.borrow().clone()) }

    fn save_draft(&self, draft: &Draft) -> Result<(), PersistenceError> {
        if self.fail_save.get() {
            return Err(PersistenceError::Locked);
        }
        *self.draft.borrow_mut() = draft.clone();
        Ok(())
    }
}

fn changed_draft() -> Draft {
    Draft {
        active_page: ActivePage::Gallery,
        ..Draft::default()
    }
}

#[test]
fn takeover_rejects_users_other_agents_and_late_snapshots_after_release() {
    let store = MemoryStore::default();
    let drafts = Arc::new(DraftCoordinator::default());
    let initial = drafts.snapshot(&store).unwrap();
    let lease = drafts.acquire_agent(&store, &initial.epoch, "run").unwrap();
    assert!(matches!(
        drafts.save_user(&store, &initial.epoch, &changed_draft()),
        Err(PersistenceError::Conflict { .. })
    ));
    assert!(drafts.guard_ui_write().is_err());
    assert!(
        drafts
            .acquire_agent(&store, &initial.epoch, "other")
            .is_err()
    );
    let edited = lease.save(&store, &changed_draft()).unwrap();
    assert_eq!(edited.owner.as_deref(), Some("run"));
    let released = lease.release().unwrap();
    assert!(released.owner.is_none());
    assert_ne!(released.epoch, initial.epoch);
    assert!(
        drafts
            .save_user(&store, &initial.epoch, &initial.draft)
            .is_err()
    );
    assert!(lease.save(&store, &initial.draft).is_err());
    assert!(drafts.guard_ui_write().is_ok());
    assert_eq!(drafts.snapshot(&store).unwrap().draft, changed_draft());
}

#[test]
fn dropping_lease_preserves_committed_edits_as_one_undo_group() {
    let store = MemoryStore::default();
    let drafts = Arc::new(DraftCoordinator::default());
    let initial = drafts.snapshot(&store).unwrap();
    {
        let lease = drafts.acquire_agent(&store, &initial.epoch, "run").unwrap();
        lease.save(&store, &changed_draft()).unwrap();
        let mut second = changed_draft();
        second.active_page = ActivePage::Library;
        lease.save(&store, &second).unwrap();
    }
    let released = drafts.snapshot(&store).unwrap();
    assert!(released.undo_available);
    let restored = drafts.undo_agent_edit(&store, &released.epoch).unwrap();
    assert!(!restored.undo_available);
    assert_eq!(restored.draft, initial.draft);
    assert_eq!(*store.draft.borrow(), initial.draft);
    assert!(
        drafts
            .save_user(&store, &released.epoch, &released.draft)
            .is_err()
    );
    assert!(drafts.undo_agent_edit(&store, &restored.epoch).is_err());
}

#[test]
fn later_user_edit_prevents_restoring_an_obsolete_agent_group() {
    let store = MemoryStore::default();
    let drafts = Arc::new(DraftCoordinator::default());
    let initial = drafts.snapshot(&store).unwrap();
    let lease = drafts.acquire_agent(&store, &initial.epoch, "run").unwrap();
    lease.save(&store, &changed_draft()).unwrap();
    let released = lease.release().unwrap();
    let mut user = changed_draft();
    user.active_page = ActivePage::Settings;
    drafts.save_user(&store, &released.epoch, &user).unwrap();
    assert!(drafts.undo_agent_edit(&store, &released.epoch).is_err());
    assert_eq!(drafts.snapshot(&store).unwrap().draft, user);
}

#[test]
fn failed_persistence_does_not_publish_the_edit_or_discard_undo() {
    let store = MemoryStore::default();
    let drafts = Arc::new(DraftCoordinator::default());
    let initial = drafts.snapshot(&store).unwrap();
    let lease = drafts.acquire_agent(&store, &initial.epoch, "run").unwrap();
    store.fail_save.set(true);
    assert!(lease.save(&store, &changed_draft()).is_err());
    assert_eq!(lease.snapshot().unwrap().draft, initial.draft);
    store.fail_save.set(false);
    lease.save(&store, &changed_draft()).unwrap();
    let released = lease.release().unwrap();
    store.fail_save.set(true);
    assert!(drafts.undo_agent_edit(&store, &released.epoch).is_err());
    assert_eq!(drafts.snapshot(&store).unwrap(), released);
    store.fail_save.set(false);
    assert_eq!(
        drafts
            .undo_agent_edit(&store, &released.epoch)
            .unwrap()
            .draft,
        initial.draft
    );
}

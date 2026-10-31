//! Serializes authoritative draft persistence and short ownership transitions.

use std::sync::{Arc, Mutex, MutexGuard};

use super::{Draft, DraftStore};
use crate::persistence::PersistenceError;

/// Current retained creation and the editing identity required by its next writer.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct DraftSnapshot {
    pub draft: Draft,
    pub epoch: String,
    /// The owning Agent run, or no owner while the user may edit.
    pub owner: Option<String>,
    pub undo_available: bool,
}

/// Application-owned draft authority, initialized only when creation data is first read.
#[derive(Default)]
pub struct DraftCoordinator {
    state: Mutex<Option<RetainedDraft>>,
}

struct RetainedDraft {
    snapshot: DraftSnapshot,
    active: Option<ActiveEdit>,
    undo: Option<AgentEdit>,
}

struct ActiveEdit {
    token: String,
    before: Draft,
}

struct AgentEdit {
    before: Draft,
    after: Draft,
}

/// Keeps user resource writes serialized against Agent takeover.
pub struct UserWriteGuard<'a> {
    _state: MutexGuard<'a, Option<RetainedDraft>>,
}

/// An exclusive Agent editing capability; releasing it invalidates outstanding tool writes.
pub struct DraftLease {
    coordinator: Arc<DraftCoordinator>,
    token: String,
    before: DraftSnapshot,
}

impl DraftCoordinator {
    fn lock(&self) -> Result<MutexGuard<'_, Option<RetainedDraft>>, PersistenceError> {
        self.state
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)
    }

    fn initialize<'a>(
        slot: &'a mut Option<RetainedDraft>,
        store: &dyn DraftStore,
    ) -> Result<&'a mut RetainedDraft, PersistenceError> {
        if slot.is_none() {
            *slot = Some(RetainedDraft {
                snapshot: DraftSnapshot {
                    draft: store.get_draft()?,
                    epoch: new_identity(),
                    owner: None,
                    undo_available: false,
                },
                active: None,
                undo: None,
            });
        }
        // Initialization above either returns its read error or fills this slot.
        Ok(slot.as_mut().expect("the retained draft was initialized"))
    }

    /// Reads the authority without starting any generation or Agent runtime.
    /// # Errors
    /// Returns creation-store or shared-state failures.
    pub fn snapshot(&self, store: &dyn DraftStore) -> Result<DraftSnapshot, PersistenceError> {
        let mut slot = self.lock()?;
        Ok(Self::initialize(&mut slot, store)?.snapshot.clone())
    }

    /// Holds the short editing boundary around a user resource write.
    /// # Errors
    /// Returns conflict while an Agent owns the workbench, or shared-state failure.
    pub fn guard_ui_write(&self) -> Result<UserWriteGuard<'_>, PersistenceError> {
        let state = self.lock()?;
        if let Some(retained) = state.as_ref() {
            require_user(retained, &retained.snapshot.epoch)?;
        }
        Ok(UserWriteGuard { _state: state })
    }

    /// Saves a user edit only in the epoch it was based on.
    /// # Errors
    /// Returns conflict for Agent ownership or a late snapshot, or persistence failure.
    pub fn save_user(
        &self,
        store: &dyn DraftStore,
        epoch: &str,
        draft: &Draft,
    ) -> Result<DraftSnapshot, PersistenceError> {
        let mut slot = self.lock()?;
        let retained = Self::initialize(&mut slot, store)?;
        require_user(retained, epoch)?;
        if retained.snapshot.draft != *draft {
            store.save_draft(draft)?;
            retained.snapshot.draft = draft.clone();
            retained.undo = None;
            retained.snapshot.undo_available = false;
        }
        Ok(retained.snapshot.clone())
    }

    /// Takes control after the user has flushed the supplied draft epoch.
    /// # Errors
    /// Returns conflict for stale or existing ownership, or creation-store failure.
    pub fn acquire_agent(
        self: &Arc<Self>,
        store: &dyn DraftStore,
        expected_epoch: &str,
        run_id: &str,
    ) -> Result<DraftLease, PersistenceError> {
        let mut slot = self.lock()?;
        let retained = Self::initialize(&mut slot, store)?;
        require_user(retained, expected_epoch)?;
        let before = retained.snapshot.clone();
        let token = new_identity();
        retained.active = Some(ActiveEdit {
            token: token.clone(),
            before: before.draft.clone(),
        });
        retained.snapshot.epoch = new_identity();
        retained.snapshot.owner = Some(run_id.to_owned());
        retained.snapshot.undo_available = false;
        tracing::info!(run_id, "Agent acquired the current creation");
        Ok(DraftLease {
            coordinator: Arc::clone(self),
            token,
            before,
        })
    }

    /// Restores the last Agent editing group if no later user edit replaced it.
    /// # Errors
    /// Returns conflict for stale ownership or no undoable edit, or persistence failure.
    pub fn undo_agent_edit(
        &self,
        store: &dyn DraftStore,
        expected_epoch: &str,
    ) -> Result<DraftSnapshot, PersistenceError> {
        let mut slot = self.lock()?;
        let retained = Self::initialize(&mut slot, store)?;
        require_user(retained, expected_epoch)?;
        let edit = retained
            .undo
            .as_ref()
            .ok_or_else(|| conflict(expected_epoch))?;
        if retained.snapshot.draft != edit.after {
            return Err(conflict(expected_epoch));
        }
        store.save_draft(&edit.before)?;
        retained.snapshot.draft = edit.before.clone();
        retained.snapshot.epoch = new_identity();
        retained.undo = None;
        retained.snapshot.undo_available = false;
        tracing::info!("restored the previous creation after Agent editing");
        Ok(retained.snapshot.clone())
    }

    fn release(&self, token: &str) -> Result<DraftSnapshot, PersistenceError> {
        let mut slot = self.lock()?;
        let retained = owned(&mut slot, token)?;
        let active = retained.active.take().expect("ownership was checked");
        if active.before != retained.snapshot.draft {
            retained.undo = Some(AgentEdit {
                before: active.before,
                after: retained.snapshot.draft.clone(),
            });
        }
        tracing::info!(run_id = ?retained.snapshot.owner, "Agent released the current creation");
        retained.snapshot.owner = None;
        retained.snapshot.undo_available = retained.undo.is_some();
        // Every release changes epoch, including cancellation without edits, so a user save
        // delayed across the entire Agent run cannot overwrite its committed result.
        retained.snapshot.epoch = new_identity();
        Ok(retained.snapshot.clone())
    }
}

impl DraftLease {
    /// The creation before this entire Agent editing group began.
    pub fn before(&self) -> &DraftSnapshot { &self.before }

    /// Reads the latest creation while this capability still owns it.
    /// # Errors
    /// Returns conflict after release, or shared-state failure.
    pub fn snapshot(&self) -> Result<DraftSnapshot, PersistenceError> {
        let mut slot = self.coordinator.lock()?;
        Ok(owned(&mut slot, &self.token)?.snapshot.clone())
    }

    /// Persists a tool edit through the same structural checks and media-reference transaction.
    /// # Errors
    /// Returns conflict after release, rejected structure or persistence failure.
    pub fn save(
        &self,
        store: &dyn DraftStore,
        draft: &Draft,
    ) -> Result<DraftSnapshot, PersistenceError> {
        let mut slot = self.coordinator.lock()?;
        let retained = owned(&mut slot, &self.token)?;
        store.save_draft(draft)?;
        retained.snapshot.draft = draft.clone();
        Ok(retained.snapshot.clone())
    }

    /// Releases ownership without rolling back already committed tool operations.
    /// # Errors
    /// Returns conflict after release, or shared-state failure.
    pub fn release(&self) -> Result<DraftSnapshot, PersistenceError> {
        self.coordinator.release(&self.token)
    }
}

impl Drop for DraftLease {
    fn drop(&mut self) {
        if let Err(error) = self.coordinator.release(&self.token)
            && !matches!(error, PersistenceError::Conflict { .. })
        {
            tracing::error!(error = ?error, "failed to release Agent creation ownership");
        }
    }
}

fn require_user(retained: &RetainedDraft, epoch: &str) -> Result<(), PersistenceError> {
    if retained.active.is_some() || retained.snapshot.epoch != epoch {
        return Err(conflict(epoch));
    }
    Ok(())
}

fn owned<'a>(
    slot: &'a mut Option<RetainedDraft>,
    token: &str,
) -> Result<&'a mut RetainedDraft, PersistenceError> {
    slot.as_mut()
        .filter(|retained| {
            retained
                .active
                .as_ref()
                .is_some_and(|active| active.token == token)
        })
        .ok_or_else(|| conflict("Agent ownership"))
}

fn conflict(epoch: &str) -> PersistenceError {
    PersistenceError::Conflict {
        kind: "current creation",
        id: epoch.to_owned(),
    }
}

fn new_identity() -> String { uuid::Uuid::new_v4().to_string() }

#[cfg(test)]
mod tests;

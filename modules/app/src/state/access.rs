//! Retained-data admission while relocation drains existing work and publishes a new path.

use std::sync::{
    Arc,
    atomic::{AtomicU8, Ordering},
};

use tokio::sync::{OwnedRwLockReadGuard, OwnedRwLockWriteGuard, RwLock};

use crate::{api::UserMessage, persistence::PersistenceError};

#[repr(u8)]
enum Phase {
    Writable,
    Relocating,
    RestartRequired,
}

/// A read lease admits an operation; the exclusive lease waits for every admitted writer.
pub(super) struct DataAccess {
    gate: Arc<RwLock<()>>,
    phase: AtomicU8,
}

impl Default for DataAccess {
    fn default() -> Self {
        Self {
            gate: Arc::new(RwLock::new(())),
            phase: AtomicU8::new(Phase::Writable as u8),
        }
    }
}

impl DataAccess {
    pub(super) fn is_writable(&self) -> bool {
        self.phase.load(Ordering::Acquire) == Phase::Writable as u8
    }

    fn check_writable(&self) -> Result<(), PersistenceError> {
        match self.phase.load(Ordering::Acquire) {
            phase if phase == Phase::Writable as u8 => Ok(()),
            phase => Err(PersistenceError::InvalidData {
                message: if phase == Phase::RestartRequired as u8 {
                    UserMessage::RestartRequired
                } else {
                    UserMessage::MigrationInProgress
                },
            }),
        }
    }

    pub(super) async fn read(&self) -> OwnedRwLockReadGuard<()> {
        Arc::clone(&self.gate).read_owned().await
    }

    pub(super) async fn write(&self) -> Result<OwnedRwLockReadGuard<()>, PersistenceError> {
        let guard = self.read().await;
        self.check_writable()?;
        Ok(guard)
    }

    pub(super) async fn exclusive_write(
        &self,
    ) -> Result<OwnedRwLockWriteGuard<()>, PersistenceError> {
        let guard = self.exclusive().await;
        self.check_writable()?;
        Ok(guard)
    }

    pub(super) async fn exclusive(&self) -> OwnedRwLockWriteGuard<()> {
        Arc::clone(&self.gate).write_owned().await
    }

    pub(super) fn begin_relocation(&self) -> Result<(), PersistenceError> {
        self.phase
            .compare_exchange(
                Phase::Writable as u8,
                Phase::Relocating as u8,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .map(|_| ())
            .map_err(|phase| PersistenceError::InvalidData {
                message: if phase == Phase::RestartRequired as u8 {
                    UserMessage::RestartRequired
                } else {
                    UserMessage::MigrationInProgress
                },
            })
    }

    pub(super) fn finish_relocation(&self, restart_required: bool) {
        self.phase.store(
            if restart_required {
                Phase::RestartRequired as u8
            } else {
                Phase::Writable as u8
            },
            Ordering::Release,
        );
    }
}

#[cfg(test)]
mod tests;

//! Temporarily exclude application writes while the host launches an update installer.

use std::sync::Arc;

use super::AppState;
use crate::{
    api::UserMessage,
    jobs::{JobError, JobQuery, JobQueue},
    persistence::PersistenceError,
};

/// Restores application writes and scheduling if installation fails or is abandoned.
pub struct UpdateGuard {
    app: AppState,
    queue: Option<Arc<JobQueue>>,
    access: Option<tokio::sync::OwnedRwLockWriteGuard<()>>,
}

impl Drop for UpdateGuard {
    fn drop(&mut self) {
        // Resume before reopening admission, so a new relocation cannot be unpaused by this guard.
        if let Some(queue) = &self.queue {
            queue.resume();
        }
        self.app.inner.access.finish_update();
        self.access.take();
    }
}

impl AppState {
    /// Rejects active assistant and paid work, then excludes writes until the guard is dropped.
    /// # Errors
    /// Returns busy application state, pending relocation/restart, or a storage failure.
    pub async fn prepare_update(&self) -> Result<UpdateGuard, JobError> {
        {
            let _transition = self
                .inner
                .agent_transition
                .lock()
                .map_err(|_error| PersistenceError::Locked)?;
            let agent = self
                .inner
                .agent
                .lock()
                .map_err(|_error| PersistenceError::Locked)?;
            if let Some(agent) = agent.as_ref()
                && agent.is_running()?
            {
                return Err(JobError::Invalid(UserMessage::UpdateBusy));
            }
            self.inner.access.begin_update()?;
        }
        // Own the admission change before awaiting, so cancellation also restores writes.
        let mut guard = UpdateGuard {
            app: self.clone(),
            queue: None,
            access: None,
        };
        guard.access = Some(self.inner.access.exclusive().await);
        let queue = self
            .inner
            .generation
            .lock()
            .map_err(|_error| PersistenceError::Locked)?
            .as_ref()
            .map(Arc::clone);
        if let Some(queue) = queue {
            // Admission is closed and existing submitters have finished; no new job can appear.
            if !queue
                .list(&JobQuery {
                    limit: 1,
                    before: None,
                })?
                .active
                .is_empty()
            {
                return Err(JobError::Invalid(UserMessage::UpdateBusy));
            }
            guard.queue = Some(Arc::clone(&queue));
            queue.pause_and_drain().await?;
        }
        tracing::info!("application writes paused for update installation");
        Ok(guard)
    }
}

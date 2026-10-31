//! Application-owned drain, exclusion and recovery around host relocation I/O.

use std::sync::Arc;

use tracing::Instrument as _;

use super::AppState;
use crate::{jobs::JobError, persistence::PersistenceError};

impl AppState {
    /// Stops new writes, drains paid requests and commits a verified copy before returning.
    /// # Errors
    /// Returns an active relocation, pending restart, storage or coordinator execution failure.
    pub async fn migrate_directory(
        &self,
        directory: Option<std::path::PathBuf>,
    ) -> Result<crate::settings::StorageLocations, JobError> {
        let app = self.clone();
        self.inner
            .runtime
            .spawn(async move { app.perform_relocation(directory).await }.in_current_span())
            .await
            .map_err(|error| {
                PersistenceError::failure("wait for the relocation coordinator", error)
            })?
    }

    async fn perform_relocation(
        &self,
        directory: Option<std::path::PathBuf>,
    ) -> Result<crate::settings::StorageLocations, JobError> {
        let database = self.database()?;
        {
            // Serialize only the start transition, never the model's network wait.
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
                return Err(PersistenceError::Conflict {
                    kind: "active assistant run",
                    id: "current creation".into(),
                }
                .into());
            }
            self.inner.access.begin_relocation()?;
        }
        let queue = if let Ok(slot) = self.inner.generation.lock() {
            slot.as_ref().map(Arc::clone)
        } else {
            self.inner.access.finish_relocation(false);
            return Err(PersistenceError::Locked.into());
        };
        let result = async {
            if let Some(queue) = &queue {
                queue.pause_and_drain().await?;
            }
            let guard = self.inner.access.exclusive().await;
            let storage = Arc::clone(&self.inner.storage);
            self.inner
                .runtime
                .spawn_blocking(move || {
                    let _guard = guard;
                    database.prepare_relocation()?;
                    storage.migrate_directory(directory.as_deref())
                })
                .await
                .map_err(|error| PersistenceError::failure("wait for data relocation", error))?
                .map_err(JobError::from)
        }
        .await;
        match result {
            Ok(locations) => {
                self.inner
                    .access
                    .finish_relocation(locations.restart_required);
                if !locations.restart_required
                    && let Some(queue) = &queue
                {
                    queue.resume();
                }
                Ok(locations)
            },
            Err(error) => {
                self.inner.access.finish_relocation(false);
                if let Some(queue) = &queue {
                    queue.resume();
                }
                Err(error)
            },
        }
    }
}

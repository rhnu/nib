//! Application ownership of resource installation tasks and their failures.

use std::sync::Arc;

use nib_resources::{ResourceError, ResourceStore};
use tracing::Instrument as _;

use super::DownloadStatus;

/// Resource tasks outlive the frontend view that initiated them.
pub struct Downloads {
    store: Arc<ResourceStore>,
    runtime: tokio::runtime::Handle,
}

impl Downloads {
    pub(crate) fn new(store: Arc<ResourceStore>, runtime: tokio::runtime::Handle) -> Self {
        Self { store, runtime }
    }

    /// Restores optional capabilities without delaying the host or creation snapshot.
    pub(crate) fn start_restore(&self) {
        let store = Arc::clone(&self.store);
        let runtime = self.runtime.clone();
        self.runtime.spawn(async move {
            let worker = Arc::clone(&store);
            match runtime.spawn_blocking(move || worker.restore_installed()).await {
                Ok(Ok(())) => {},
                Ok(Err(error)) => {
                    tracing::error!(error = ?error, "resource recovery failed");
                    if let Err(error) = store.restore_worker_failed(&error.to_string()) {
                        tracing::error!(error = ?error, "cannot publish resource recovery failure");
                    }
                },
                Err(error) => {
                    tracing::error!(error = ?error, "resource recovery worker failed");
                    if let Err(error) = store.restore_worker_failed(&error.to_string()) {
                        tracing::error!(error = ?error, "cannot publish resource recovery failure");
                    }
                },
            }
        }.in_current_span());
    }

    /// Reports the current catalog, installed components and task progress.
    /// # Errors
    /// Returns a shared resource-state failure.
    pub fn status(&self) -> Result<DownloadStatus, ResourceError> { self.store.status() }

    /// Refreshes the remote catalog outside the async executor.
    /// # Errors
    /// Returns a resource operation or worker execution failure.
    pub async fn refresh_catalog(&self) -> Result<DownloadStatus, ResourceError> {
        let store = Arc::clone(&self.store);
        self.runtime
            .spawn_blocking(move || store.refresh_catalog())
            .await
            .map_err(worker_error)?
    }

    /// Claims an installation synchronously before its independent worker starts.
    /// # Errors
    /// Returns invalid input, a missing resource, conflicting work or backend failure.
    pub fn install(&self, id: String, components: &[String]) -> Result<(), ResourceError> {
        self.store.begin_install(&id, components)?;
        let store = Arc::clone(&self.store);
        let runtime = self.runtime.clone();
        self.runtime.spawn(async move {
            let worker = Arc::clone(&store);
            let worker_id = id.clone();
            if let Err(error) = runtime.spawn_blocking(move || worker.install_prepared(&worker_id)).await {
                tracing::error!(resource = id, error = %error, "resource installation worker failed");
                store.worker_failed(&id, error.to_string());
            }
        }.in_current_span());
        Ok(())
    }

    /// Cancels matching work, including installation waiting for its worker to run.
    /// # Errors
    /// Returns a shared resource-state failure.
    pub fn cancel(&self, id: &str) -> Result<(), ResourceError> { self.store.cancel(id) }

    /// Removes a resource after checking that no installation is using it.
    /// # Errors
    /// Returns invalid input, conflicting work, backend or worker execution failures.
    pub async fn uninstall(&self, id: String) -> Result<DownloadStatus, ResourceError> {
        let store = Arc::clone(&self.store);
        self.runtime
            .spawn_blocking(move || store.uninstall(&id))
            .await
            .map_err(worker_error)?
    }
}

fn worker_error(error: tokio::task::JoinError) -> ResourceError {
    ResourceError::Failure(
        anyhow::Error::new(error).context("wait for the resource operation worker"),
    )
}

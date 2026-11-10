//! Platform I/O assembly passed to the application bootstrap.

use std::{path::Path, sync::Arc};

use nib_app::bootstrap::Bootstrap;

use crate::{
    credentials::NativeCredentials, sdk::ReqwestTransportFactory, state::DesktopState,
    storage::StorageManager,
};

pub(crate) fn start(
    base: &Path,
    development: bool,
    handle: tauri::AppHandle,
) -> anyhow::Result<DesktopState> {
    let started = std::time::Instant::now();
    let storage = Arc::new(StorageManager::open(base, development)?);
    storage.upgrade_creation()?;
    tracing::debug!(
        elapsed_ms = started.elapsed().as_millis(),
        "opened storage and completed database upgrades"
    );
    let credentials = Arc::new(NativeCredentials::new(development));
    let app = Bootstrap {
        configure_mcp_command,
        settings: Arc::clone(&storage.settings),
        credentials,
        storage,
        transports: Arc::new(ReqwestTransportFactory),
        runtime: tauri::async_runtime::handle().inner().clone(),
        resources_directory: base.join("resources"),
    }
    .start()?;
    let desktop = DesktopState::new(app, handle);
    tracing::info!(
        elapsed_ms = started.elapsed().as_millis(),
        "desktop bootstrap completed"
    );
    Ok(desktop)
}

fn configure_mcp_command(command: &mut tokio::process::Command) {
    #[cfg(target_os = "windows")]
    command.creation_flags(0x0800_0000);
    #[cfg(not(target_os = "windows"))]
    let _command = command;
}

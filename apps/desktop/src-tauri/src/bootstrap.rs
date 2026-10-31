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
    let storage = Arc::new(StorageManager::open(base, development)?);
    storage.upgrade_creation()?;
    let credentials = Arc::new(NativeCredentials::new(development));
    let app = Bootstrap {
        settings: Arc::clone(&storage.settings),
        credentials,
        storage,
        transports: Arc::new(ReqwestTransportFactory),
        runtime: tauri::async_runtime::handle().inner().clone(),
        resources_directory: base.join("resources"),
    }
    .start()?;
    Ok(DesktopState::new(app, handle))
}

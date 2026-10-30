//! Frontend settings requests use application-owned preference and relocation behavior.

use nib_app::{
    api::ApiError,
    settings::{ApplicationPreferences, ApplicationSettingsSnapshot, StorageLocations},
};

use crate::{commands::persistence_error, state::DesktopState};

#[tauri::command]
pub(crate) async fn get_application_settings(
    state: tauri::State<'_, DesktopState>,
) -> Result<ApplicationSettingsSnapshot, ApiError> {
    let app = state.app.clone();
    crate::generation::blocking(move || app.settings_snapshot().map_err(persistence_error)).await
}

#[tauri::command]
pub(crate) async fn save_application_preferences(
    state: tauri::State<'_, DesktopState>,
    preferences: ApplicationPreferences,
) -> Result<ApplicationPreferences, ApiError> {
    let access = state.app.write_access().await.map_err(persistence_error)?;
    let app = state.app.clone();
    crate::generation::blocking(move || {
        let _access = access;
        app.save_preferences(&preferences)
            .map_err(crate::generation::generation_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_data_directory(
    state: tauri::State<'_, DesktopState>,
    directory: Option<String>,
) -> Result<StorageLocations, ApiError> {
    state
        .app
        .migrate_directory(directory.map(std::path::PathBuf::from))
        .await
        .map_err(crate::generation::generation_error)
}

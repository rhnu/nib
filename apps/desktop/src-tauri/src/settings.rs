//! Global preferences can be read even when the creation database is unavailable.

use std::{path::Path, sync::Arc};

use nib_app::{
    api::ApiError,
    settings::{ApplicationPreferences, ApplicationSettingsSnapshot, StorageLocations},
};

use crate::{commands::persistence_error, state::DesktopState};

#[tauri::command]
pub(crate) async fn get_application_settings(
    state: tauri::State<'_, DesktopState>,
) -> Result<ApplicationSettingsSnapshot, ApiError> {
    let storage = Arc::clone(&state.storage);
    crate::generation::blocking(move || {
        Ok(ApplicationSettingsSnapshot {
            preferences: storage.settings.preferences().map_err(persistence_error)?,
            storage: storage.locations().map_err(persistence_error)?,
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_application_preferences(
    state: tauri::State<'_, DesktopState>,
    preferences: ApplicationPreferences,
) -> Result<ApplicationPreferences, ApiError> {
    let storage = Arc::clone(&state.storage);
    crate::generation::blocking(move || {
        storage
            .settings
            .save_preferences(&preferences)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn set_data_directory(
    state: tauri::State<'_, DesktopState>,
    directory: Option<String>,
) -> Result<StorageLocations, ApiError> {
    let storage = Arc::clone(&state.storage);
    crate::generation::blocking(move || {
        storage
            .set_directory(directory.as_deref().map(Path::new))
            .map_err(persistence_error)
    })
    .await
}

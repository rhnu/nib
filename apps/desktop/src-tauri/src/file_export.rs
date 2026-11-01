//! User-selected export destinations stay inside the native save dialog boundary.
use nib_app::{api::ApiError, persistence::PersistenceError};
use tauri_plugin_dialog::DialogExt as _;

use crate::commands::persistence_error;

/// Writes an export only after the user selects its destination; cancellation is successful.
#[tauri::command]
pub(crate) async fn save_export_file(
    app: tauri::AppHandle,
    filename: String,
    bytes: Vec<u8>,
) -> Result<bool, ApiError> {
    crate::generation::blocking(move || {
        let name = std::path::Path::new(&filename)
            .file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new("nib-export"))
            .to_string_lossy();
        let extension = std::path::Path::new(name.as_ref())
            .extension()
            .and_then(|value| value.to_str());
        let mut dialog = app.dialog().file().set_file_name(name.as_ref());
        if let Some(extension) = extension {
            dialog = dialog.add_filter(extension.to_uppercase(), &[extension]);
        }
        let Some(destination) = dialog.blocking_save_file() else {
            return Ok(false);
        };
        let path = destination.into_path().map_err(|error| {
            persistence_error(PersistenceError::failure(
                "select an export destination",
                error,
            ))
        })?;
        std::fs::write(&path, bytes).map_err(|error| {
            persistence_error(PersistenceError::failure(
                "write the selected export file",
                error,
            ))
        })?;
        tracing::debug!("saved export to the selected destination");
        Ok(true)
    })
    .await
}

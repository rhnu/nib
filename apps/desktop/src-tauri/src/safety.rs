//! Native local analysis commands use immutable asset identities and application data access.

use nib_app::{
    api::{ApiError, ErrorCode, UserMessage},
    safety::{ImageAnalysisStatus, ImageSafety, ImageTags},
};

use crate::{commands::persistence_error, generation::blocking, state::DesktopState};

#[tauri::command]
pub(crate) async fn get_image_analysis_status(
    state: tauri::State<'_, DesktopState>,
) -> Result<ImageAnalysisStatus, ApiError> {
    let app = state.app.clone();
    blocking(move || app.safety().status().map_err(persistence_error)).await
}

#[tauri::command]
pub(crate) async fn get_image_safety(
    state: tauri::State<'_, DesktopState>,
    asset_id: String,
) -> Result<ImageSafety, ApiError> {
    let app = state.app.clone();
    let access = app.read_access().await;
    blocking(move || {
        let _access = access;
        app.media()
            .map_err(persistence_error)?
            .image_safety(&asset_id)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn rescan_image_safety(
    state: tauri::State<'_, DesktopState>,
    asset_id: String,
) -> Result<ImageSafety, ApiError> {
    let app = state.app.clone();
    let access = app.write_access().await.map_err(persistence_error)?;
    blocking(move || {
        let _access = access;
        app.media()
            .map_err(persistence_error)?
            .scan_image_safety(&asset_id, true)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn extract_image_tags(
    state: tauri::State<'_, DesktopState>,
    asset_id: String,
    general_threshold: f32,
    character_threshold: f32,
) -> Result<ImageTags, ApiError> {
    let app = state.app.clone();
    let access = app.read_access().await;
    blocking(move || {
        let _access = access;
        let media = app.media().map_err(persistence_error)?;
        let model = app.safety().status().map_err(persistence_error)?.wd;
        if !model.available {
            return Err(ApiError {
                code: ErrorCode::Unavailable,
                validation_fields: Vec::new(),
                message: match (model.error, model.loading) {
                    (Some(error), _) => UserMessage::external(error),
                    (None, true) => UserMessage::OperationIncomplete,
                    (None, false) => UserMessage::external(
                        "Install the WD SwinV2 tagger resource to extract image tags.",
                    ),
                },
            });
        }
        app.safety()
            .extract_tags(&media, &asset_id, general_threshold, character_threshold)
            .map_err(persistence_error)
    })
    .await
}

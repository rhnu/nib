//! Media IPC delivers bytes and identities without exposing arbitrary file paths.

use std::sync::Arc;

use nib_app::{
    api::ApiError,
    media::{
        AssetSource, GenerationResult, ImageMetadataReport, MediaAsset, MediaLibrary,
        MetadataRestore,
    },
    session::Draft,
};

use crate::{commands::persistence_error, generation::blocking, state::DesktopState};

async fn with_media<T: Send + 'static>(
    state: tauri::State<'_, DesktopState>,
    action: impl FnOnce(Arc<MediaLibrary>) -> Result<T, ApiError> + Send + 'static,
) -> Result<T, ApiError> {
    let state = state.inner().clone();
    blocking(move || action(state.media().map_err(persistence_error)?)).await
}

#[tauri::command]
pub(crate) async fn list_media_assets(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<MediaAsset>, ApiError> {
    with_media(state, |media| {
        media.list_assets().map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn get_media_asset(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<MediaAsset, ApiError> {
    with_media(state, move |media| {
        media.asset(&id).map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn import_image_asset(
    state: tauri::State<'_, DesktopState>,
    bytes: Vec<u8>,
    name: Option<String>,
    source_asset_id: Option<String>,
) -> Result<MediaAsset, ApiError> {
    with_media(state, move |media| {
        media
            .import_image(
                bytes,
                source_asset_id.map_or(AssetSource::Import { name }, |asset_id| {
                    AssetSource::Asset { asset_id }
                }),
            )
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn import_vibe_asset(
    state: tauri::State<'_, DesktopState>,
    bytes: Vec<u8>,
    name: Option<String>,
) -> Result<MediaAsset, ApiError> {
    with_media(state, move |media| {
        media
            .import_vibe(bytes, AssetSource::Import { name })
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn read_media_asset(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<tauri::ipc::Response, ApiError> {
    with_media(state, move |media| {
        Ok(tauri::ipc::Response::new(
            media.read_asset(&id).map_err(persistence_error)?.bytes,
        ))
    })
    .await
}

#[tauri::command]
pub(crate) async fn inspect_image_metadata(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<ImageMetadataReport, ApiError> {
    with_media(state, move |media| {
        media.inspect_metadata(&id).map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn import_embedded_vibes(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<Vec<MediaAsset>, ApiError> {
    with_media(state, move |media| {
        media.import_embedded_vibes(&id).map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn restore_image_metadata(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<MetadataRestore, ApiError> {
    with_media(state, move |media| {
        media.restore_metadata(&id).map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn list_results(
    state: tauri::State<'_, DesktopState>,
) -> Result<Vec<GenerationResult>, ApiError> {
    with_media(state, |media| media.list().map_err(persistence_error)).await
}

#[tauri::command]
pub(crate) async fn read_result_content(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<tauri::ipc::Response, ApiError> {
    with_media(state, move |media| {
        Ok(tauri::ipc::Response::new(
            media.read(&id).map_err(persistence_error)?.bytes,
        ))
    })
    .await
}

#[tauri::command]
pub(crate) async fn restore_result(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<Draft, ApiError> {
    with_media(state, move |media| {
        media.restore(&id).map_err(persistence_error)
    })
    .await
}

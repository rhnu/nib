//! Media IPC delivers bytes and identities without exposing arbitrary file paths.

use std::sync::Arc;

use nib_app::{
    api::ApiError,
    media::{
        AssetSource, GenerationResult, ImageMetadataReport, MediaAsset, MediaLibrary,
        MetadataRestore,
    },
    session::{CreationOperation, Draft, ImageOperationKind, ImageOperationOptions},
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
pub(crate) fn get_image_operation_options() -> ImageOperationOptions {
    nib_app::session::image_operation_options()
}

#[tauri::command]
pub(crate) async fn create_image_operation(
    state: tauri::State<'_, DesktopState>,
    id: String,
    kind: ImageOperationKind,
) -> Result<CreationOperation, ApiError> {
    with_media(state, move |media| {
        nib_app::session::create_image_operation(media.as_ref(), id, kind)
            .map_err(persistence_error)
    })
    .await
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
pub(crate) async fn create_image_vibe_document(
    state: tauri::State<'_, DesktopState>,
    image_id: String,
) -> Result<MediaAsset, ApiError> {
    with_media(state, move |media| {
        media
            .create_image_vibe_document(&image_id)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn create_encoded_vibe_document(
    state: tauri::State<'_, DesktopState>,
    vibe_id: String,
    model_key: String,
) -> Result<MediaAsset, ApiError> {
    with_media(state, move |media| {
        media
            .create_encoded_vibe_document(&vibe_id, &model_key)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn bundle_vibe_documents(
    state: tauri::State<'_, DesktopState>,
    document_ids: Vec<String>,
) -> Result<MediaAsset, ApiError> {
    with_media(state, move |media| {
        media
            .bundle_vibe_documents(&document_ids)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn import_vibe_document(
    state: tauri::State<'_, DesktopState>,
    bytes: Vec<u8>,
    name: Option<String>,
) -> Result<MediaAsset, ApiError> {
    with_media(state, move |media| {
        media
            .import_vibe_document(&bytes, AssetSource::Import { name })
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn import_png_vibe_document(
    state: tauri::State<'_, DesktopState>,
    image_id: String,
) -> Result<Option<MediaAsset>, ApiError> {
    with_media(state, move |media| {
        media
            .import_png_vibe_document(&image_id)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn export_vibe_document(
    state: tauri::State<'_, DesktopState>,
    id: String,
) -> Result<tauri::ipc::Response, ApiError> {
    with_media(state, move |media| {
        Ok(tauri::ipc::Response::new(
            media
                .export_vibe_document(&id)
                .map_err(persistence_error)?
                .bytes,
        ))
    })
    .await
}

#[tauri::command]
pub(crate) async fn embed_vibe_document(
    state: tauri::State<'_, DesktopState>,
    document_id: String,
    image_id: String,
) -> Result<MediaAsset, ApiError> {
    with_media(state, move |media| {
        media
            .embed_vibe_document(&document_id, &image_id)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn write_png_text(
    state: tauri::State<'_, DesktopState>,
    image_id: String,
    entries: Vec<(String, String)>,
) -> Result<MediaAsset, ApiError> {
    with_media(state, move |media| {
        let entries = entries
            .into_iter()
            .map(|(keyword, text)| novelai_bridge::PngTextEntry::new(keyword, text))
            .collect::<Vec<_>>();
        media
            .write_png_text(&image_id, &entries)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn import_document_image(
    state: tauri::State<'_, DesktopState>,
    document_id: String,
    entry_index: usize,
) -> Result<MediaAsset, ApiError> {
    with_media(state, move |media| {
        media
            .import_document_image(&document_id, entry_index)
            .map_err(persistence_error)
    })
    .await
}

#[tauri::command]
pub(crate) async fn import_document_encoding(
    state: tauri::State<'_, DesktopState>,
    document_id: String,
    entry_index: usize,
    model_key: String,
    parameter_key: String,
) -> Result<MediaAsset, ApiError> {
    with_media(state, move |media| {
        media
            .import_document_encoding(&document_id, entry_index, &model_key, &parameter_key)
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

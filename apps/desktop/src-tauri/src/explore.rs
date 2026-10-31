//! Source-bound Explore IPC; only explicit import writes to local media.
use nib_app::{
    explore::{
        ExploreDetail, ExploreError, ExploreErrorKind, ExploreItemKey, ExploreMediaVariant,
        ExplorePage, ExploreQuery,
    },
    media::{MediaAsset, MetadataRestore},
    persistence::PersistenceError,
    session::DraftStore as _,
};

use crate::state::DesktopState;

fn local_error(error: PersistenceError) -> ExploreError {
    tracing::error!(?error, "Explore local data operation failed");
    ExploreError::new(ExploreErrorKind::Unavailable, "Local data is unavailable").with_source(error)
}

fn worker_error() -> ExploreError {
    ExploreError::new(
        ExploreErrorKind::Unavailable,
        "Explore operation did not complete",
    )
}

#[tauri::command]
pub(crate) async fn search_explore(
    state: tauri::State<'_, DesktopState>,
    query: ExploreQuery,
    cursor: Option<String>,
) -> Result<ExplorePage, ExploreError> {
    state.app.explore().search(query, cursor).await
}

#[tauri::command]
pub(crate) async fn get_explore_detail(
    state: tauri::State<'_, DesktopState>,
    key: ExploreItemKey,
) -> Result<ExploreDetail, ExploreError> {
    state.app.explore().detail(&key).await
}

#[tauri::command]
pub(crate) async fn read_explore_media(
    state: tauri::State<'_, DesktopState>,
    key: ExploreItemKey,
    variant: ExploreMediaVariant,
) -> Result<tauri::ipc::Response, ExploreError> {
    Ok(tauri::ipc::Response::new(
        state.app.explore().media(&key, variant).await?.bytes,
    ))
}

#[tauri::command]
pub(crate) async fn import_explore_image(
    state: tauri::State<'_, DesktopState>,
    key: ExploreItemKey,
) -> Result<MediaAsset, ExploreError> {
    let explore = std::sync::Arc::clone(state.app.explore());
    let content = explore.media(&key, ExploreMediaVariant::Original).await?;
    let access = state.app.write_access().await.map_err(local_error)?;
    let desktop = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _access = access;
        let media = desktop.app.media().map_err(local_error)?;
        explore.import(&media, &key, content)
    })
    .await
    .map_err(|_error| worker_error())?
}

#[tauri::command]
pub(crate) async fn restore_explore_metadata(
    state: tauri::State<'_, DesktopState>,
    key: ExploreItemKey,
) -> Result<MetadataRestore, ExploreError> {
    let desktop = state.inner().clone();
    let access = state.app.read_access().await;
    let current = tauri::async_runtime::spawn_blocking(move || {
        let _access = access;
        desktop
            .app
            .database()
            .map_err(local_error)?
            .get_draft()
            .map_err(local_error)
    })
    .await
    .map_err(|_error| worker_error())??;
    state.app.explore().restore_metadata(&key, current).await
}

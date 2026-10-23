//! Desktop host responsible for native startup and the application IPC boundary.

use anyhow::Context as _;
use tauri::Manager as _;
use tracing_subscriber::{EnvFilter, filter::LevelFilter};

mod commands;
mod credentials;
mod generation;
mod media;
mod sdk;
mod settings;
mod state;
mod storage;

/// Initializes host diagnostics and runs the native desktop event loop.
///
/// # Errors
/// Returns an error if the log filter or subscriber cannot be initialized, or if
/// the desktop runtime fails to start or run its event loop.
pub fn run() -> anyhow::Result<()> {
    initialize_tracing()?;

    tracing::info!(version = env!("CARGO_PKG_VERSION"), "starting nib");
    tauri::Builder::default()
        .setup(|app| {
            let development = tauri::is_dev();
            let base = if development {
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .ancestors()
                    .nth(3)
                    .context("the desktop host must be inside the nib workspace")?
                    .join(".dev")
            } else {
                app.path().app_data_dir()?
            };
            app.manage(state::DesktopState::new(&base, development)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_application_settings,
            settings::save_application_preferences,
            settings::set_data_directory,
            commands::get_workspace,
            commands::search_resources,
            commands::get_resource,
            commands::get_resource_definitions,
            commands::save_resource,
            commands::delete_resource,
            commands::save_draft,
            commands::resolve_draft,
            commands::get_model_defaults_capabilities,
            commands::expand_chunk,
            commands::expand_preset,
            commands::suggest_tags,
            commands::inspect_tokens,
            generation::get_account_status,
            generation::save_account_key,
            generation::delete_account_key,
            generation::quote_generation,
            generation::submit_generation,
            generation::list_jobs,
            generation::get_job,
            generation::cancel_job,
            generation::retry_job,
            generation::get_account_summary,
            generation::refresh_account_summary,
            generation::subscribe_job_feedback,
            generation::unsubscribe_job_feedback,
            media::list_results,
            media::get_result,
            media::read_media_thumbnail,
            media::restore_result,
            media::list_media_assets,
            media::get_image_operation_options,
            media::create_image_operation,
            media::create_inpaint_operation,
            media::create_precise_reference,
            media::create_vibe_encoding_input,
            media::get_vibe_encoding_options,
            media::create_vibe_reference,
            media::inspect_vibe_document,
            media::inspect_vibe_asset,
            media::prepare_vibe_reencoding,
            media::get_media_asset,
            media::import_image_asset,
            media::import_vibe_asset,
            media::import_vibe_document,
            media::create_image_vibe_document,
            media::create_encoded_vibe_document,
            media::bundle_vibe_documents,
            media::import_png_vibe_document,
            media::export_vibe_document,
            media::embed_vibe_document,
            media::write_png_text,
            media::inspect_png_text,
            media::get_director_options,
            media::import_document_image,
            media::import_document_encoding,
            media::read_media_asset,
            media::inspect_image_metadata,
            media::import_embedded_vibes,
            media::restore_image_metadata,
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed)
                && let Err(error) = window
                    .state::<state::DesktopState>()
                    .stop_feedback(window.label(), None)
            {
                tracing::warn!(error = %error, "cannot release window feedback subscription");
            }
        })
        .run(tauri::generate_context!())
        .context("run the nib desktop application")
}

fn initialize_tracing() -> anyhow::Result<()> {
    let filter = EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .from_env()
        .context("parse the RUST_LOG tracing filter")?;
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .try_init()
        .map_err(anyhow::Error::from_boxed)
        .context("initialize the desktop tracing subscriber")
}

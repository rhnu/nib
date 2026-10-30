//! Desktop host responsible for native startup and the application IPC boundary.

use anyhow::Context as _;
use tauri::Manager as _;
use tracing_subscriber::{EnvFilter, filter::LevelFilter};

mod commands;
mod credentials;
mod downloads;
mod generation;
mod lexicon;
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let development = tauri::is_dev();
            let base = application_base(app.handle(), development)?;
            let desktop = state::DesktopState::new(&base, development)?;
            if let Err(error) = desktop.sdk() {
                tracing::warn!(error = %error, "cannot initialize account sampling");
            }
            app.manage(desktop);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            lexicon::search_lexicon,
            lexicon::get_lexicon_status,
            downloads::get_download_status,
            downloads::refresh_download_catalog,
            downloads::install_download,
            downloads::cancel_download,
            downloads::uninstall_download,
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
            commands::get_prompt_syntax,
            commands::expand_chunk,
            commands::expand_preset,
            commands::inspect_tokens,
            generation::get_account_status,
            generation::save_account_key,
            generation::activate_account,
            generation::delete_account_key,
            generation::quote_generation,
            generation::submit_generation,
            generation::ensure_vibe_encoding,
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

/// Select a development data root without replacing an existing retained creation.
fn application_base(
    app: &tauri::AppHandle,
    development: bool,
) -> anyhow::Result<std::path::PathBuf> {
    if !development {
        return Ok(app.path().app_data_dir()?);
    }
    if let Some(path) = std::env::var_os("NIB_DEVELOPMENT_HOME") {
        let path = std::path::PathBuf::from(path);
        anyhow::ensure!(
            path.is_absolute(),
            "NIB_DEVELOPMENT_HOME must be an absolute path"
        );
        return Ok(path);
    }
    Ok(std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .context("the desktop host must be inside the nib workspace")?
        .join(".dev"))
}

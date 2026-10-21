//! Desktop host responsible for native startup and the application IPC boundary.

use anyhow::Context as _;
use tauri::Manager as _;
use tracing_subscriber::{EnvFilter, filter::LevelFilter};

mod commands;
mod credentials;
mod generation;
mod state;

/// Initializes host diagnostics and runs the native desktop event loop.
///
/// # Errors
/// Returns an error if the log filter or subscriber cannot be initialized, or if
/// the desktop runtime fails to start or run its event loop.
pub fn run() -> anyhow::Result<()> {
    let filter = EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .from_env()
        .context("parse the RUST_LOG tracing filter")?;
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .try_init()
        .map_err(anyhow::Error::from_boxed)
        .context("initialize the desktop tracing subscriber")?;

    tracing::info!(version = env!("CARGO_PKG_VERSION"), "starting nib");
    tauri::Builder::default()
        .setup(|app| {
            app.manage(state::DesktopState::new(app.path().app_data_dir()?));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_workspace,
            commands::search_resources,
            commands::get_resource,
            commands::save_resource,
            commands::delete_resource,
            commands::save_draft,
            commands::resolve_draft,
            commands::expand_chunk,
            commands::expand_preset,
            generation::get_account_status,
            generation::save_account_key,
            generation::delete_account_key,
            generation::quote_generation,
            generation::submit_generation,
            generation::list_jobs,
            generation::cancel_job,
            generation::retry_job,
            generation::list_results,
            generation::read_result_image,
            generation::restore_result,
        ])
        .run(tauri::generate_context!())
        .context("run the nib desktop application")
}

//! Desktop host responsible for native startup and the application IPC boundary.

use anyhow::Context as _;
use tracing_subscriber::{EnvFilter, filter::LevelFilter};

/// Exposes application metadata to the local desktop frontend.
#[tauri::command]
fn get_app_info() -> nib_app::api::AppInfo { nib_app::app_info() }

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
        .invoke_handler(tauri::generate_handler![get_app_info])
        .run(tauri::generate_context!())
        .context("run the nib desktop application")
}

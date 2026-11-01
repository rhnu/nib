//! Creates the main window with the saved appearance before its first paint.

use anyhow::Context as _;
use nib_app::settings::Theme;
use tauri::{WebviewWindowBuilder, window::Color};

/// The configuration database stays authoritative; only the initial theme enters the document.
pub(crate) fn create(handle: &tauri::AppHandle, theme: Theme) -> anyhow::Result<()> {
    let config = handle
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .context("find the main window configuration")?;
    let background = match theme {
        Theme::Dark => Color(0x1B, 0x1D, 0x21, 0xFF),
        Theme::Light => Color(0xFF, 0xFF, 0xFF, 0xFF),
    };
    let script = format!(
        "window.__NIB_STARTUP_THEME__ = {};",
        serde_json::to_string(&theme)?
    );
    WebviewWindowBuilder::from_config(handle, config)?
        .background_color(background)
        .initialization_script(script)
        .build()
        .context("create the main window with its saved theme")?;
    tracing::debug!(?theme, "created main window with its startup appearance");
    Ok(())
}

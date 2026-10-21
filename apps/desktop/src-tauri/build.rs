fn main() -> Result<(), Box<dyn std::error::Error>> {
    // The official create-tauri-app template icon is a build placeholder, not product artwork.
    // Source: https://github.com/tauri-apps/create-tauri-app/tree/dev/templates/_base_/src-tauri/icons
    let attributes = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(&["get_app_info"]));
    tauri_build::try_build(attributes)?;
    Ok(())
}

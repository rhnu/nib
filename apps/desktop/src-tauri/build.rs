fn main() -> Result<(), Box<dyn std::error::Error>> {
    // The official create-tauri-app template icon is a build placeholder, not product artwork.
    // Source: https://github.com/tauri-apps/create-tauri-app/tree/dev/templates/_base_/src-tauri/icons
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "get_workspace",
            "search_resources",
            "get_resource",
            "save_resource",
            "delete_resource",
            "save_draft",
            "resolve_draft",
            "expand_chunk",
            "expand_preset",
            "get_account_status",
            "save_account_key",
            "delete_account_key",
            "quote_generation",
            "submit_generation",
            "list_jobs",
            "cancel_job",
            "retry_job",
            "list_results",
            "read_result_image",
            "restore_result",
        ]));
    tauri_build::try_build(attributes)?;
    Ok(())
}

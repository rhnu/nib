fn main() -> Result<(), Box<dyn std::error::Error>> {
    // The official create-tauri-app template icon is a build placeholder, not product artwork.
    // Source: https://github.com/tauri-apps/create-tauri-app/tree/dev/templates/_base_/src-tauri/icons
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "get_application_settings",
            "save_application_preferences",
            "set_data_directory",
            "get_workspace",
            "search_resources",
            "get_resource",
            "save_resource",
            "delete_resource",
            "save_draft",
            "resolve_draft",
            "get_model_capabilities",
            "get_model_defaults_capabilities",
            "expand_chunk",
            "expand_preset",
            "suggest_tags",
            "inspect_tokens",
            "get_account_status",
            "save_account_key",
            "delete_account_key",
            "get_account_summary",
            "refresh_account_summary",
            "quote_generation",
            "submit_generation",
            "list_jobs",
            "cancel_job",
            "retry_job",
            "list_results",
            "read_result_content",
            "restore_result",
            "list_media_assets",
            "get_media_asset",
            "import_image_asset",
            "read_media_asset",
            "inspect_image_metadata",
            "restore_image_metadata",
            "get_image_operation_options",
            "create_image_operation",
            "create_inpaint_operation",
        ]));
    tauri_build::try_build(attributes)?;
    Ok(())
}

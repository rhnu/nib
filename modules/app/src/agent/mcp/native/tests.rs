use super::*;

#[test]
fn redacts_nested_tool_output_preserving_json_and_error_content() {
    let output = ToolOutput::json(
        serde_json::json!({"ok": false, "detail": ["Bearer private-token", {"header": "private-token"}]}),
    );
    let clean = sanitized_output(&output, &["private-token".to_owned()]).unwrap();
    assert_eq!(clean.as_json().unwrap()["ok"], false);
    assert_eq!(clean.as_json().unwrap()["detail"][0], "Bearer [REDACTED]");
    assert!(!clean.render().contains("private-token"));
}

#[test]
fn rejects_ambiguous_authentication_and_protocol_overrides() {
    let mut secrets = McpSecrets {
        bearer_token: Some("token".into()),
        ..Default::default()
    };
    secrets
        .headers
        .insert("Authorization".into(), "Basic credentials".into());
    assert!(validate_secrets(&secrets).is_err());
    secrets.bearer_token = None;
    secrets.headers.clear();
    secrets
        .headers
        .insert("Mcp-Session-Id".into(), "session".into());
    assert!(validate_secrets(&secrets).is_err());
}

#[test]
fn recognizes_empty_secret_sets_and_preserves_named_empty_environment_values() {
    let mut secrets = McpSecrets::default();
    assert!(secrets.is_empty());
    secrets.bearer_token = Some(String::new());
    assert!(secrets.is_empty());
    secrets.bearer_token = Some("token".into());
    assert!(!secrets.is_empty());
    secrets.bearer_token = None;
    secrets
        .headers
        .insert("Authorization".into(), "Basic credentials".into());
    assert!(!secrets.is_empty());
    secrets.headers.clear();
    secrets.env.insert("OPTION".into(), String::new());
    assert!(!secrets.is_empty());
}

use super::*;

#[test]
fn credential_input_requires_both_fields_and_a_basic_auth_username() {
    for (username, key) in [
        ("", "key"),
        ("user", ""),
        ("user:name", "key"),
        ("user\nname", "key"),
        ("user", "ke\ny"),
    ] {
        assert!(matches!(
            prepare_credentials(username, key),
            Err(DanbooruConnectionError::InvalidInput)
        ));
    }
    let credentials = prepare_credentials("  user ", " key ").unwrap();
    assert_eq!(credentials.username, "user");
    assert_eq!(credentials.api_key.expose_secret(), "key");
}

#[test]
fn profile_validation_rejects_anonymous_and_mismatched_identities() {
    for profile in [
        Profile {
            id: 0,
            name: "user".into(),
        },
        Profile {
            id: 10,
            name: "another".into(),
        },
    ] {
        assert!(matches!(
            validate_profile(&profile, "user"),
            Err(DanbooruConnectionError::ProfileMismatch)
        ));
    }
    validate_profile(
        &Profile {
            id: 10,
            name: "User".into(),
        },
        "user",
    )
    .unwrap();
}

#[test]
fn invalid_configured_connection_remains_distinct_from_anonymous() {
    let mut metadata = DanbooruMetadata {
        username: Some("user".into()),
        secret_id: Some("version".into()),
        user_id: Some(10),
        revision: 2,
        valid: true,
    };
    assert_eq!(metadata.status().state, DanbooruConnectionState::Connected);
    metadata.valid = false;
    metadata.advance().unwrap();
    let status = metadata.status();
    assert_eq!(status.state, DanbooruConnectionState::Invalid);
    assert_eq!(status.username.as_deref(), Some("user"));
    assert_eq!(status.revision, 3);
}

#[test]
fn blank_key_only_retains_the_same_saved_account() {
    assert!(reuse_stored_key(" User ", " \t ", Some("user")).unwrap());
    assert!(matches!(
        reuse_stored_key("other", "", Some("user")),
        Err(DanbooruConnectionError::InvalidInput)
    ));
    assert!(matches!(
        reuse_stored_key("user", "", None),
        Err(DanbooruConnectionError::InvalidInput)
    ));
    assert!(!reuse_stored_key("other", "new-key", Some("user")).unwrap());
}

#[test]
fn authentication_is_encoded_in_a_header_without_url_secret_parameters() {
    let credentials = prepare_credentials("example", "secret").unwrap();
    let request = credentials
        .authorize(reqwest::Client::new().get("https://danbooru.donmai.us/profile.json"))
        .build()
        .unwrap();
    assert!(
        request
            .headers()
            .contains_key(reqwest::header::AUTHORIZATION)
    );
    assert!(request.url().query().is_none());
}

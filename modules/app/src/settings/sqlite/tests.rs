use super::*;

#[test]
fn replacing_key_retains_frozen_version_and_renaming_keeps_selection() {
    let store =
        GlobalSettingsStore::from_connection(Connection::open_in_memory().unwrap()).unwrap();
    store
        .save_credential("profile", "First", Some("version-one"))
        .unwrap();
    store
        .save_credential("other", "Second", Some("version-other"))
        .unwrap();
    assert_eq!(
        store.active_credential().unwrap().as_deref(),
        Some("version-one")
    );
    store
        .save_credential("profile", "Renamed", Some("version-two"))
        .unwrap();
    assert_eq!(
        store.active_credential().unwrap().as_deref(),
        Some("version-two")
    );
    assert_eq!(store.credential_versions("profile").unwrap().len(), 2);
    store
        .save_credential("profile", "Title only", None)
        .unwrap();
    assert_eq!(
        store.active_credential().unwrap().as_deref(),
        Some("version-two")
    );
    let status = store.credentials().unwrap();
    assert_eq!(status.credentials[0].name, "Title only");
    store.activate_credential("other").unwrap();
    assert_eq!(
        store.active_credential().unwrap().as_deref(),
        Some("version-other")
    );
}

#[test]
fn missing_selection_rolls_back_and_removing_active_does_not_choose_another() {
    let store =
        GlobalSettingsStore::from_connection(Connection::open_in_memory().unwrap()).unwrap();
    store.save_credential("first", "First", Some("v1")).unwrap();
    store
        .save_credential("second", "Second", Some("v2"))
        .unwrap();
    assert!(store.activate_credential("missing").is_err());
    assert_eq!(store.active_credential().unwrap().as_deref(), Some("v1"));
    store.delete_credential("first").unwrap();
    assert!(store.active_credential().unwrap().is_none());
    assert_eq!(store.credentials().unwrap().credentials.len(), 1);
}

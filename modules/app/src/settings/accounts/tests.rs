use std::error::Error as _;

use super::*;

#[test]
fn empty_name_is_rejected_before_missing_key() {
    assert!(matches!(
        prepare_account(None, " \t ", None),
        Err(AccountError::Invalid(UserMessage::AccountNameRequired))
    ));
}

#[test]
fn new_accounts_require_a_nonblank_key() {
    for key in [None, Some(" \r\n ")] {
        assert!(matches!(
            prepare_account(None, "Account", key),
            Err(AccountError::Invalid(UserMessage::ApiKeyRequired))
        ));
    }
}

#[test]
fn rename_retains_identity_without_replacing_key() {
    for key in [None, Some(" \t ")] {
        let (id, name, secret) =
            prepare_account(Some("existing".into()), " Account \n", key).unwrap();
        assert_eq!(id, "existing");
        assert_eq!(name, "Account");
        assert!(secret.is_none());
    }
}

#[test]
fn surrounding_key_whitespace_is_removed_before_sdk_validation() {
    let (_, name, secret) =
        prepare_account(None, " Account ", Some(" \r\n example-key \t")).unwrap();
    assert_eq!(name, "Account");
    validate_api_key(&secret.unwrap()).unwrap();
}

#[test]
fn backend_error_conversion_preserves_causes() {
    let persistence = AccountError::from(PersistenceError::failure(
        "save account",
        std::io::Error::other("storage unavailable"),
    ));
    assert!(matches!(persistence, AccountError::Persistence(_)));
    assert!(persistence.source().is_some());

    let credential = AccountError::from(CredentialError::failure(
        "save credential",
        std::io::Error::other("credential backend unavailable"),
    ));
    assert!(matches!(credential, AccountError::Credential(_)));
    assert!(credential.source().is_some());
}

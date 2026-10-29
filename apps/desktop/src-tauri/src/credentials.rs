//! The desktop selects the secret backend; no secret is part of retained app data.

use std::sync::{Arc, Mutex};

use nib_app::settings::{CredentialError, CredentialStore};
use novelai_bridge::SecretString;
use secrecy::ExposeSecret as _;

use crate::storage::StorageManager;

/// Serializes access to the one `NovelAI` API key in the OS credential store.
pub(crate) struct NativeCredentials {
    entry: Mutex<()>,
    storage: Arc<StorageManager>,
    development: bool,
}

impl NativeCredentials {
    pub(crate) fn new(development: bool, storage: Arc<StorageManager>) -> Self {
        Self {
            entry: Mutex::new(()),
            storage,
            development,
        }
    }

    fn with_entry<T>(
        &self,
        id: &str,
        action: impl FnOnce(&keyring_core::Entry) -> Result<T, keyring_core::Error>,
    ) -> Result<T, CredentialError> {
        let _guard = self
            .entry
            .lock()
            .map_err(|_poisoned| CredentialError::Locked)?;
        let entry = create_entry(self.development, id)
            .map_err(|error| CredentialError::failure("open the native credential store", error))?;
        action(&entry).map_err(|error| match error {
            keyring_core::Error::BadEncoding(_) | keyring_core::Error::BadDataFormat(..) => {
                CredentialError::InvalidKey
            },
            error => CredentialError::failure("access the NovelAI credential", error),
        })
    }
}

impl CredentialStore for NativeCredentials {
    fn active_id(&self) -> Result<Option<String>, CredentialError> {
        self.storage
            .settings
            .active_credential()
            .map_err(|error| CredentialError::failure("read the active account", error))
    }

    fn load(&self, id: &str) -> Result<Option<SecretString>, CredentialError> {
        self.with_entry(id, |entry| match entry.get_password() {
            Ok(value) => Ok(Some(SecretString::from(value))),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(error) => Err(error),
        })
    }

    fn save(&self, id: &str, key: SecretString) -> Result<(), CredentialError> {
        self.with_entry(id, |entry| entry.set_password(key.expose_secret()))
    }

    fn delete(&self, id: &str) -> Result<(), CredentialError> {
        self.with_entry(id, |entry| match entry.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(error) => Err(error),
        })
    }
}

#[cfg(windows)]
fn create_entry(development: bool, id: &str) -> Result<keyring_core::Entry, keyring_core::Error> {
    use keyring_core::api::CredentialStoreApi as _;
    // Keep credentials local to this machine rather than roaming with a Windows account.
    windows_native_keyring_store::Store::new()?.build(
        if development {
            "dev.rhynia.nib.development"
        } else {
            "dev.rhynia.nib"
        },
        id,
        Some(&std::collections::HashMap::from([("persistence", "Local")])),
    )
}

#[cfg(not(windows))]
fn create_entry(_development: bool, _id: &str) -> Result<keyring_core::Entry, keyring_core::Error> {
    Err(keyring_core::Error::NoDefaultStore)
}

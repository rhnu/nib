//! The desktop selects the secret backend; no secret is part of retained app data.

use std::sync::Mutex;

use nib_app::settings::{CredentialError, CredentialStore};
use novelai_bridge::SecretString;
use secrecy::ExposeSecret as _;

/// Serializes access to the one `NovelAI` API key in the OS credential store.
pub(crate) struct NativeCredentials {
    entry: Mutex<Option<keyring_core::Entry>>,
    development: bool,
}

impl NativeCredentials {
    pub(crate) fn new(development: bool) -> Self {
        Self {
            entry: Mutex::new(None),
            development,
        }
    }

    fn with_entry<T>(
        &self,
        action: impl FnOnce(&keyring_core::Entry) -> Result<T, keyring_core::Error>,
    ) -> Result<T, CredentialError> {
        let mut slot = self
            .entry
            .lock()
            .map_err(|_poisoned| CredentialError::Locked)?;
        if slot.is_none() {
            *slot = Some(create_entry(self.development).map_err(|error| {
                CredentialError::failure("open the native credential store", error)
            })?);
        }
        action(slot.as_ref().expect("the credential entry was initialized")).map_err(|error| {
            match error {
                // These variants retain raw secret bytes, so discard their payload at this boundary.
                keyring_core::Error::BadEncoding(_) | keyring_core::Error::BadDataFormat(..) => {
                    CredentialError::InvalidKey
                },
                error => CredentialError::failure("access the NovelAI credential", error),
            }
        })
    }
}

impl CredentialStore for NativeCredentials {
    fn load(&self) -> Result<Option<SecretString>, CredentialError> {
        self.with_entry(|entry| match entry.get_password() {
            Ok(value) => Ok(Some(SecretString::from(value))),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(error) => Err(error),
        })
    }

    fn save(&self, key: SecretString) -> Result<(), CredentialError> {
        self.with_entry(|entry| entry.set_password(key.expose_secret()))
    }

    fn delete(&self) -> Result<(), CredentialError> {
        self.with_entry(|entry| match entry.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(error) => Err(error),
        })
    }
}

#[cfg(windows)]
fn create_entry(development: bool) -> Result<keyring_core::Entry, keyring_core::Error> {
    use keyring_core::api::CredentialStoreApi as _;
    // Keep credentials local to this machine rather than roaming with a Windows account.
    windows_native_keyring_store::Store::new()?.build(
        if development {
            "dev.rhynia.nib.development"
        } else {
            "dev.rhynia.nib"
        },
        "novelai-api-key",
        Some(&std::collections::HashMap::from([("persistence", "Local")])),
    )
}

#[cfg(not(windows))]
fn create_entry(_development: bool) -> Result<keyring_core::Entry, keyring_core::Error> {
    Err(keyring_core::Error::NoDefaultStore)
}

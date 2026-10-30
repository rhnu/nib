//! Account metadata and immutable credential versions shared by host adapters.

use novelai_bridge::SecretString;

use super::{
    AccountStatus, CredentialError, CredentialStore, GlobalSettingsStore, validate_api_key,
};
use crate::{api::UserMessage, jobs::JobStore, persistence::PersistenceError};

/// Account changes retain backend causes while distinguishing user input and pending jobs.
#[derive(Debug, thiserror::Error)]
pub enum AccountError {
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
    #[error(transparent)]
    Credential(#[from] CredentialError),
    #[error("{0}")]
    Invalid(UserMessage),
    #[error("the account has unfinished jobs")]
    PendingJobs,
}

fn account_id() -> String {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |time| time.as_nanos());
    format!(
        "credential-{timestamp:x}-{:x}",
        SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

fn prepare_account(
    id: Option<String>,
    name: &str,
    key: Option<&str>,
) -> Result<(String, String, Option<SecretString>), AccountError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AccountError::Invalid(UserMessage::AccountNameRequired));
    }
    let new_profile = id.is_none();
    let secret = key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| SecretString::from(value.to_owned()));
    if new_profile && secret.is_none() {
        return Err(AccountError::Invalid(UserMessage::ApiKeyRequired));
    }
    Ok((id.unwrap_or_else(account_id), name.to_owned(), secret))
}

/// Saves profile metadata and publishes a new immutable key version when supplied.
///
/// # Errors
/// Returns invalid input or backend failures; failed publication removes the new key if possible.
pub fn save_account(
    settings: &GlobalSettingsStore,
    credentials: &dyn CredentialStore,
    id: Option<String>,
    name: &str,
    key: Option<&str>,
) -> Result<AccountStatus, AccountError> {
    let (id, name, secret) = prepare_account(id, name, key)?;
    let secret_id = secret.as_ref().map(|_| account_id());
    if let (Some(secret), Some(secret_id)) = (secret, secret_id.as_deref()) {
        validate_api_key(&secret)?;
        credentials.save(secret_id, secret)?;
    }
    if let Err(error) = settings.save_credential(&id, &name, secret_id.as_deref()) {
        if let Some(secret_id) = secret_id
            && credentials.delete(&secret_id).is_err()
        {
            tracing::warn!("cannot remove unpublished credential version");
        }
        return Err(error.into());
    }
    Ok(settings.credentials()?)
}

/// Selects an existing account for subsequent operations.
///
/// # Errors
/// Returns persistence failures, including an unknown account identity.
pub fn activate_account(
    settings: &GlobalSettingsStore,
    id: &str,
) -> Result<AccountStatus, AccountError> {
    settings.activate_credential(id)?;
    Ok(settings.credentials()?)
}

/// Removes all retained keys and then metadata after checking every version for unfinished jobs.
///
/// # Errors
/// Returns pending jobs or backend failures without removing metadata before native keys succeed.
pub fn delete_account(
    settings: &GlobalSettingsStore,
    credentials: &dyn CredentialStore,
    jobs: &dyn JobStore,
    id: &str,
) -> Result<AccountStatus, AccountError> {
    let versions = settings.credential_versions(id)?;
    for version in &versions {
        if !jobs.unfinished_credential_jobs(version)?.is_empty() {
            return Err(AccountError::PendingJobs);
        }
    }
    for version in versions {
        credentials.delete(&version)?;
    }
    settings.delete_credential(id)?;
    Ok(settings.credentials()?)
}

#[cfg(test)]
mod tests;

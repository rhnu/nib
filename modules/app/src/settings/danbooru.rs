//! One optional Danbooru connection; validation precedes publication of a new secret.

use std::{
    sync::{Arc, RwLock},
    time::Duration,
};

use novelai_bridge::SecretString;
use secrecy::ExposeSecret as _;
use serde::{Deserialize, Serialize};

use super::{CredentialError, CredentialStore, GlobalSettingsStore};
use crate::persistence::PersistenceError;

/// Only connection metadata crosses the desktop boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct DanbooruConnectionStatus {
    pub state: DanbooruConnectionState,
    pub username: Option<String>,
    pub revision: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum DanbooruConnectionState {
    Disconnected,
    Connected,
    Invalid,
}

/// Provider errors retain classification without retaining response bodies or secret values.
#[derive(Debug, thiserror::Error)]
pub enum DanbooruConnectionError {
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
    #[error(transparent)]
    Credential(#[from] CredentialError),
    #[error("a Danbooru username and API key are required")]
    InvalidInput,
    #[error("the Danbooru connection is missing or invalid; reconnect before browsing")]
    InvalidConnection,
    #[error("Danbooru rejected the supplied credentials")]
    Rejected,
    #[error("Danbooru returned HTTP {status}")]
    Http { status: u16 },
    #[error("the Danbooru profile did not match the supplied username")]
    ProfileMismatch,
    #[error("the Danbooru connection changed during this operation")]
    Conflict,
    #[error("the Danbooru request failed")]
    Transport(#[source] reqwest::Error),
}

/// An immutable query identity; configured invalid connections never become anonymous.
pub struct DanbooruAccess {
    pub revision: u32,
    pub credentials: Option<DanbooruCredentials>,
}

/// Transient secrets have no serialization or debug representation.
pub struct DanbooruCredentials {
    pub username: String,
    api_key: SecretString,
    user_id: Option<i64>,
}

impl DanbooruCredentials {
    /// Attaches Basic authentication to a request for the fixed Danbooru API origin.
    pub fn authorize(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let request = request.basic_auth(&self.username, Some(self.api_key.expose_secret()));
        if let Some(user_id) = self.user_id {
            request.header(
                reqwest::header::USER_AGENT,
                format!(
                    concat!("nib/", env!("CARGO_PKG_VERSION"), " (by Danbooru user #{})"),
                    user_id
                ),
            )
        } else {
            request
        }
    }
}

pub(super) struct DanbooruMetadata {
    pub username: Option<String>,
    pub secret_id: Option<String>,
    pub user_id: Option<i64>,
    pub revision: u32,
    pub valid: bool,
}

impl DanbooruMetadata {
    fn status(&self) -> DanbooruConnectionStatus {
        DanbooruConnectionStatus {
            state: if self.username.is_none() {
                DanbooruConnectionState::Disconnected
            } else if self.valid {
                DanbooruConnectionState::Connected
            } else {
                DanbooruConnectionState::Invalid
            },
            username: self.username.clone(),
            revision: self.revision,
        }
    }

    fn advance(&mut self) -> Result<(), DanbooruConnectionError> {
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(DanbooruConnectionError::Conflict)?;
        Ok(())
    }
}

#[derive(Deserialize)]
struct Profile {
    id: i64,
    name: String,
}

/// Serializes explicit changes while query identities are rejected using persisted revisions.
pub struct DanbooruConnection {
    settings: Arc<GlobalSettingsStore>,
    secrets: Arc<dyn CredentialStore>,
    client: reqwest::Client,
    changes: tokio::sync::Mutex<()>,
    revision_gate: RwLock<()>,
}

impl DanbooruConnection {
    /// Builds a client that never follows redirects carrying provider authentication.
    /// # Errors
    /// Returns HTTP client initialization failures.
    pub fn new(
        settings: Arc<GlobalSettingsStore>,
        secrets: Arc<dyn CredentialStore>,
    ) -> Result<Self, DanbooruConnectionError> {
        let client = reqwest::Client::builder()
            .user_agent(concat!("nib/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(DanbooruConnectionError::Transport)?;
        Ok(Self {
            settings,
            secrets,
            client,
            changes: tokio::sync::Mutex::new(()),
            revision_gate: RwLock::new(()),
        })
    }

    /// Reads metadata without contacting Danbooru or opening creation data.
    /// # Errors
    /// Returns configuration access failures.
    pub fn status(&self) -> Result<DanbooruConnectionStatus, DanbooruConnectionError> {
        Ok(self.settings.danbooru_metadata()?.status())
    }

    /// Freezes one source identity, failing explicitly if its configured secret is unavailable.
    /// # Errors
    /// Returns invalid connection, configuration or native secret failures.
    pub fn access(&self) -> Result<DanbooruAccess, DanbooruConnectionError> {
        let metadata = self.settings.danbooru_metadata()?;
        let credentials = match (metadata.username, metadata.secret_id) {
            (Some(username), Some(secret_id)) if metadata.valid => {
                let Some(api_key) = self.secrets.load(&secret_id)? else {
                    self.mark_invalid(metadata.revision)?;
                    return Err(DanbooruConnectionError::InvalidConnection);
                };
                Some(DanbooruCredentials {
                    username,
                    api_key,
                    user_id: metadata.user_id,
                })
            },
            (None, None) => None,
            _ => return Err(DanbooruConnectionError::InvalidConnection),
        };
        Ok(DanbooruAccess {
            revision: metadata.revision,
            credentials,
        })
    }

    /// Checks whether an in-flight response still belongs to the selected source.
    /// # Errors
    /// Returns configuration access failures.
    pub fn is_current(&self, revision: u32) -> Result<bool, DanbooruConnectionError> {
        Ok(self.settings.danbooru_metadata()?.revision == revision)
    }

    /// Keeps a synchronous local commit within the source revision that authorized it.
    /// # Errors
    /// Returns stale identity or configuration access failures before invoking the operation.
    pub fn with_current_revision<T>(
        &self,
        revision: u32,
        operation: impl FnOnce() -> T,
    ) -> Result<T, DanbooruConnectionError> {
        let _revision = self
            .revision_gate
            .read()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        if !self.is_current(revision)? {
            return Err(DanbooruConnectionError::Conflict);
        }
        Ok(operation())
    }

    fn publish(
        &self,
        previous_revision: u32,
        metadata: &DanbooruMetadata,
    ) -> Result<bool, DanbooruConnectionError> {
        // Network requests and secret I/O remain outside this short publication section.
        let _revision = self
            .revision_gate
            .write()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        Ok(self
            .settings
            .save_danbooru_metadata(previous_revision, metadata)?)
    }

    /// Rejects future authenticated queries without silently retrying anonymously.
    /// # Errors
    /// Returns configuration access failures.
    pub fn mark_invalid(&self, revision: u32) -> Result<(), DanbooruConnectionError> {
        let mut metadata = self.settings.danbooru_metadata()?;
        if metadata.revision == revision && metadata.username.is_some() && metadata.valid {
            metadata.valid = false;
            metadata.advance()?;
            if self.publish(revision, &metadata)? {
                tracing::info!("Danbooru connection requires reauthentication");
            }
        }
        Ok(())
    }

    async fn validate(
        &self,
        credentials: &DanbooruCredentials,
    ) -> Result<Profile, DanbooruConnectionError> {
        let response = credentials
            .authorize(self.client.get("https://danbooru.donmai.us/profile.json"))
            .send()
            .await
            .map_err(DanbooruConnectionError::Transport)?;
        let status = response.status();
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            return Err(DanbooruConnectionError::Rejected);
        }
        if !status.is_success() {
            return Err(DanbooruConnectionError::Http {
                status: status.as_u16(),
            });
        }
        let profile = response
            .json::<Profile>()
            .await
            .map_err(DanbooruConnectionError::Transport)?;
        validate_profile(&profile, &credentials.username)?;
        Ok(profile)
    }

    /// Verifies replacement credentials before publishing metadata or changing the old secret.
    /// # Errors
    /// Returns rejected credentials or persistence failures; the previous connection remains selected.
    pub async fn save(
        &self,
        username: &str,
        api_key: &str,
    ) -> Result<DanbooruConnectionStatus, DanbooruConnectionError> {
        let _change = self.changes.lock().await;
        let old = self.settings.danbooru_metadata()?;
        let reuse = reuse_stored_key(username, api_key, old.username.as_deref())?;
        let credentials = if reuse {
            let secret_id = old
                .secret_id
                .as_deref()
                .ok_or(DanbooruConnectionError::InvalidConnection)?;
            DanbooruCredentials {
                username: username.trim().to_owned(),
                api_key: self
                    .secrets
                    .load(secret_id)?
                    .ok_or(DanbooruConnectionError::InvalidConnection)?,
                user_id: old.user_id,
            }
        } else {
            prepare_credentials(username, api_key)?
        };
        let profile = self.validate(&credentials).await?;
        let secret_id = if reuse {
            old.secret_id
                .clone()
                .ok_or(DanbooruConnectionError::InvalidConnection)?
        } else {
            let secret_id = format!("danbooru-{}", uuid::Uuid::new_v4());
            self.secrets.save(&secret_id, credentials.api_key)?;
            secret_id
        };
        let mut metadata = DanbooruMetadata {
            username: Some(profile.name),
            secret_id: Some(secret_id.clone()),
            user_id: Some(profile.id),
            revision: old.revision,
            valid: true,
        };
        metadata.advance()?;
        let published = self.publish(old.revision, &metadata);
        match published {
            Ok(true) => {},
            error => {
                if !reuse && self.secrets.delete(&secret_id).is_err() {
                    tracing::warn!("cannot remove unpublished Danbooru credential");
                }
                error?;
                return Err(DanbooruConnectionError::Conflict);
            },
        }
        if !reuse
            && let Some(old_id) = old.secret_id
            && self.secrets.delete(&old_id).is_err()
        {
            tracing::warn!("cannot remove replaced Danbooru credential");
        }
        tracing::info!(revision = metadata.revision, "Danbooru connection saved");
        Ok(metadata.status())
    }

    /// Revalidates the saved connection; rejection changes status without selecting anonymous access.
    /// # Errors
    /// Returns network, secret or configuration failures.
    pub async fn verify(&self) -> Result<DanbooruConnectionStatus, DanbooruConnectionError> {
        let _change = self.changes.lock().await;
        let mut metadata = self.settings.danbooru_metadata()?;
        let username = metadata
            .username
            .clone()
            .ok_or(DanbooruConnectionError::InvalidConnection)?;
        let secret_id = metadata
            .secret_id
            .as_deref()
            .ok_or(DanbooruConnectionError::InvalidConnection)?;
        let Some(api_key) = self.secrets.load(secret_id)? else {
            self.mark_invalid(metadata.revision)?;
            return self.status();
        };
        let valid = match self
            .validate(&DanbooruCredentials {
                username,
                api_key,
                user_id: metadata.user_id,
            })
            .await
        {
            Ok(_) => true,
            Err(DanbooruConnectionError::Rejected | DanbooruConnectionError::ProfileMismatch) => {
                false
            },
            Err(error) => return Err(error),
        };
        let revision = metadata.revision;
        if valid != metadata.valid {
            metadata.valid = valid;
            metadata.advance()?;
            if !self.publish(revision, &metadata)? {
                return Err(DanbooruConnectionError::Conflict);
            }
        } else if !self.is_current(revision)? {
            return Err(DanbooruConnectionError::Conflict);
        }
        tracing::info!(valid, "Danbooru connection verified");
        Ok(metadata.status())
    }

    /// Explicitly disconnects the account and advances the source identity for anonymous queries.
    /// # Errors
    /// Returns native secret or configuration failures.
    pub async fn disconnect(&self) -> Result<DanbooruConnectionStatus, DanbooruConnectionError> {
        let _change = self.changes.lock().await;
        let old = self.settings.danbooru_metadata()?;
        let mut metadata = DanbooruMetadata {
            username: None,
            secret_id: None,
            user_id: None,
            revision: old.revision,
            valid: false,
        };
        metadata.advance()?;
        if !self.publish(old.revision, &metadata)? {
            return Err(DanbooruConnectionError::Conflict);
        }
        if let Some(secret_id) = &old.secret_id
            && let Err(error) = self.secrets.delete(secret_id)
        {
            tracing::warn!("Danbooru disconnected; native credential cleanup failed");
            return Err(error.into());
        }
        tracing::info!(
            revision = metadata.revision,
            "Danbooru connection disconnected"
        );
        Ok(metadata.status())
    }
}

fn prepare_credentials(
    username: &str,
    api_key: &str,
) -> Result<DanbooruCredentials, DanbooruConnectionError> {
    let username = username.trim();
    let api_key = api_key.trim();
    if username.is_empty()
        || api_key.is_empty()
        || username.contains(':')
        || username.chars().any(char::is_control)
        || api_key.chars().any(char::is_control)
    {
        return Err(DanbooruConnectionError::InvalidInput);
    }
    Ok(DanbooruCredentials {
        username: username.to_owned(),
        api_key: api_key.to_owned().into(),
        user_id: None,
    })
}

fn reuse_stored_key(
    username: &str,
    api_key: &str,
    previous_username: Option<&str>,
) -> Result<bool, DanbooruConnectionError> {
    if !api_key.trim().is_empty() {
        return Ok(false);
    }
    if previous_username.is_some_and(|previous| previous.eq_ignore_ascii_case(username.trim())) {
        return Ok(true);
    }
    Err(DanbooruConnectionError::InvalidInput)
}

fn validate_profile(profile: &Profile, username: &str) -> Result<(), DanbooruConnectionError> {
    if profile.id <= 0 || !profile.name.eq_ignore_ascii_case(username) {
        return Err(DanbooruConnectionError::ProfileMismatch);
    }
    Ok(())
}

#[cfg(test)]
mod tests;

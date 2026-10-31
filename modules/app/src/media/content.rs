//! Content-addressed media storage and validated application identities.

use std::{
    fmt,
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    str::FromStr,
    sync::Mutex,
};

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::MediaLibrary;
use crate::{api::UserMessage, persistence::PersistenceError};

static PUBLICATION: Mutex<()> = Mutex::new(());

/// The SHA-256 of the exact retained bytes, serialized as lowercase hexadecimal.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
#[cfg_attr(feature = "typegen", ts(type = "string"))]
pub struct BlobId(String);

impl Serialize for BlobId {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.as_str().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for BlobId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, thiserror::Error)]
#[error("a media blob identity must contain 64 lowercase SHA-256 hexadecimal characters")]
pub struct InvalidBlobId;

impl BlobId {
    /// Computes identity without decoding or normalizing the original content.
    pub fn for_bytes(bytes: &[u8]) -> Self {
        use std::fmt::Write as _;
        Self(
            Sha256::digest(bytes)
                .iter()
                .fold(String::with_capacity(64), |mut text, byte| {
                    write!(&mut text, "{byte:02x}").expect("writing a String is infallible");
                    text
                }),
        )
    }

    pub fn as_str(&self) -> &str { &self.0 }
}

impl fmt::Display for BlobId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl FromStr for BlobId {
    type Err = InvalidBlobId;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            Ok(Self(value.to_owned()))
        } else {
            Err(InvalidBlobId)
        }
    }
}

impl TryFrom<String> for BlobId {
    type Error = InvalidBlobId;

    fn try_from(value: String) -> Result<Self, Self::Error> { value.parse() }
}

impl From<BlobId> for String {
    fn from(value: BlobId) -> Self { value.0 }
}

impl ToSql for BlobId {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::Borrowed(ValueRef::Text(self.0.as_bytes())))
    }
}

impl FromSql for BlobId {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        value
            .as_str()?
            .parse()
            .map_err(|error| FromSqlError::Other(Box::new(error)))
    }
}

/// Assets keep UUID identity independent from shared content identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct AssetId(uuid::Uuid);

impl AssetId {
    pub(super) fn new() -> Self { Self(uuid::Uuid::new_v4()) }

    pub(super) fn parse(id: &str) -> Result<Self, PersistenceError> {
        match uuid::Uuid::parse_str(id) {
            Ok(value) if value.hyphenated().to_string() == id && !value.is_nil() => Ok(Self(value)),
            _ => Err(PersistenceError::InvalidData {
                message: UserMessage::InvalidMediaId,
            }),
        }
    }
}

impl fmt::Display for AssetId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.hyphenated().fmt(formatter)
    }
}

/// Removes this invocation's incomplete staging file on every failure path.
struct StagedFile(PathBuf);

impl Drop for StagedFile {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_file(&self.0)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(path = %self.0.display(), ?error, "cannot remove media staging file");
        }
    }
}

impl MediaLibrary {
    pub(super) fn blob_path(&self, id: &BlobId) -> PathBuf {
        self.directory.join("objects").join(id.as_str())
    }

    pub(super) fn thumbnail_filename(id: &BlobId) -> String { format!("{id}-256-v1.png") }

    /// Publishes a fully synchronized file, sharing existing valid content.
    pub(super) fn retain_blob(&self, bytes: &[u8]) -> Result<BlobId, PersistenceError> {
        if bytes.is_empty() {
            return Err(PersistenceError::InvalidData {
                message: UserMessage::IncompleteMedia,
            });
        }
        let id = BlobId::for_bytes(bytes);
        let staging_path = self
            .directory
            .join("staging")
            .join(format!("{}.partial", AssetId::new()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging_path)
            .map_err(|error| PersistenceError::failure("create staged media content", error))?;
        let staging = StagedFile(staging_path);
        let written = (|| {
            file.write_all(bytes)
                .map_err(|error| PersistenceError::failure("write staged media content", error))?;
            file.sync_all()
                .map_err(|error| PersistenceError::failure("sync staged media content", error))
        })();
        // Windows cannot unlink an open staging file. Close it before propagating
        // a write failure so the staging guard can remove the partial content.
        drop(file);
        written?;

        // The data directory has one process owner. This lock also serializes independent
        // MediaLibrary handles so a damaged object can be replaced without a delete gap.
        let _publication = PUBLICATION
            .lock()
            .map_err(|_poisoned| PersistenceError::Locked)?;
        let path = self.blob_path(&id);
        match fs::read(&path) {
            Ok(existing) if existing.len() == bytes.len() && BlobId::for_bytes(&existing) == id => {
            },
            Ok(_) => {
                fs::rename(&staging.0, &path).map_err(|error| {
                    PersistenceError::failure("replace damaged media content", error)
                })?;
                tracing::warn!(blob_id = %id, "repaired damaged media content");
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::rename(&staging.0, &path).map_err(|error| {
                    PersistenceError::failure("publish immutable media content", error)
                })?;
                tracing::debug!(blob_id = %id, byte_length = bytes.len(), "published media content");
            },
            Err(error) => {
                return Err(PersistenceError::failure(
                    "validate existing media content",
                    error,
                ));
            },
        }
        Ok(id)
    }
}

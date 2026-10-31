//! Local image assessment preserves evidence independently of presentation preferences.

pub use nib_contract::safety::*;

#[cfg(feature = "native")]
mod native;
#[cfg(any(feature = "native", test))]
mod policy;
mod sqlite;
#[cfg(feature = "native")]
pub use native::SafetyScanner;

use crate::persistence::PersistenceError;

/// An unavailable or failed attempt keeps previous completed evidence in storage.
pub struct ScanOutcome {
    pub status: SafetyStatus,
    pub reason: Option<String>,
    pub assessment: Option<SafetyAssessment>,
}

impl ScanOutcome {
    pub(crate) fn unknown(reason: impl Into<String>) -> Self {
        Self {
            status: SafetyStatus::Unknown,
            reason: Some(reason.into()),
            assessment: None,
        }
    }
}

/// Media persistence invokes local analysis without depending on an inference backend.
pub trait ImageSafetyScanner: Send + Sync {
    /// # Errors
    /// Returns configuration storage failures. Model failures produce an unknown outcome.
    fn scan(&self, bytes: &[u8], manual: bool) -> Result<ScanOutcome, PersistenceError>;
}

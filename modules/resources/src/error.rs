//! Errors retain the distinction between rejected requests and resource backend failures.

/// Public resource operations report actionable request categories without losing causes.
#[derive(Debug, thiserror::Error)]
pub enum ResourceError {
    #[error("invalid resource request")]
    Invalid(#[source] anyhow::Error),
    #[error("resource was not found: {0}")]
    NotFound(String),
    #[error("resource operation conflicts with current state: {0}")]
    Conflict(&'static str),
    #[error("resource operation failed")]
    Failure(#[from] anyhow::Error),
}

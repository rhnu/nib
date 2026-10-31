//! The single process ONNX environment shared by native resource consumers.

use std::sync::Mutex;

/// Failures initializing or accessing the shared inference runtime.
#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("ONNX environment state is unavailable")]
    State,
    #[error("could not initialize ONNX Runtime")]
    Initialization(#[from] ort::Error),
}

/// Get the shared environment without initializing any model sessions.
///
/// # Errors
/// Returns an initialization failure or a poisoned state lock.
pub fn environment() -> Result<ort::environment::Environment, RuntimeError> {
    static ENVIRONMENT: Mutex<Option<ort::environment::Environment>> = Mutex::new(None);
    let mut environment = ENVIRONMENT
        .lock()
        .map_err(|_poisoned| RuntimeError::State)?;
    if let Some(environment) = environment.as_ref() {
        return Ok(environment.clone());
    }
    let initialized = ort::init().build()?;
    *environment = Some(initialized.clone());
    Ok(initialized)
}

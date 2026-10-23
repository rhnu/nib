//! Session validation coordinates editor state and prompt composition invariants.

use super::Draft;
use crate::prompt::{
    ValidationError,
    validation::{outputs, validate_presets},
};

/// Checks retained editor state and unambiguous composition and instance identities.
/// NAI parameter validity remains with the SDK when preparing an operation.
///
/// # Errors
/// Returns the field and reason for the first structural violation.
pub fn validate_draft(draft: &Draft) -> Result<(), ValidationError> {
    draft.mask_editor.validate()?;
    draft.director.validate()?;
    draft.png_text_editor.validate()?;
    if let Some(encoder) = &draft.vibe_encoder {
        encoder.validate("vibeEncoder")?;
    }
    outputs(
        &draft.composition,
        &draft.characters,
        &draft.inputs.references,
        false,
    )?;
    draft.inputs.operation.validate()?;
    validate_presets(&draft.presets)
}

#[cfg(test)]
mod tests;

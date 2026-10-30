//! Downloadable machine-local resource communication types.

pub use nib_contract::downloads::*;

#[cfg(feature = "native")]
mod native;
#[cfg(feature = "native")]
pub use native::Downloads;
#[cfg(feature = "native")]
pub use nib_resources::ResourceError;

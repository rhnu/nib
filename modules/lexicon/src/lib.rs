//! Native, downloadable vocabulary and semantic search outside the prompt WASM dependency tree.

mod encoder;
pub mod format;
mod index;
pub mod pack;
mod resources;
mod search;
mod semantic;

pub use resources::{LexiconResources, query_pack, verify_pack};

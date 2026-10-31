//! Application data and behavior, independent of the desktop host.

pub mod api;
#[cfg(feature = "native")]
pub mod bootstrap;
pub mod downloads;
pub mod explore;
pub mod jobs;
pub mod lexicon;
pub mod library;
pub mod media;
pub mod persistence;
pub mod prompt;
pub mod safety;
pub mod sdk;
pub mod session;
pub mod settings;
#[cfg(feature = "native")]
pub mod state;

/// Reports the application identity and the bridge's current default model.
pub fn app_info() -> api::AppInfo {
    api::AppInfo {
        name: "nib".to_owned(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        default_model_id: novelai_bridge::Model::default().as_str().to_owned(),
    }
}

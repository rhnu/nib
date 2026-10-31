//! Explicit application dependencies supplied by a platform host.

use std::{path::PathBuf, sync::Arc};

use crate::{
    downloads::Downloads,
    sdk::TransportFactory,
    settings::{CredentialStore, GlobalSettingsStore, StorageBackend},
    state::AppState,
};

/// Platform I/O and runtime are supplied before application capabilities are assembled.
pub struct Bootstrap {
    pub settings: Arc<GlobalSettingsStore>,
    pub credentials: Arc<dyn CredentialStore>,
    pub storage: Arc<dyn StorageBackend>,
    pub transports: Arc<dyn TransportFactory>,
    pub runtime: tokio::runtime::Handle,
    pub resources_directory: PathBuf,
}

impl Bootstrap {
    /// Opens optional resource capabilities without requiring credentials or a creation database.
    /// # Errors
    /// Returns failures opening resource storage or restoring its shared state.
    pub fn start(self) -> anyhow::Result<AppState> {
        let lexicon = Arc::new(nib_lexicon::LexiconResources::default());
        let analyzer = Arc::new(nib_image_analysis::ImageAnalyzer::default());
        let safety = Arc::new(crate::safety::SafetyScanner::new(
            Arc::clone(&analyzer),
            Arc::clone(&self.settings),
        ));
        let consumers = std::collections::BTreeMap::from([
            (
                "lexicon".to_owned(),
                Arc::clone(&lexicon) as Arc<dyn nib_resources::ResourceConsumer>,
            ),
            ("anime-dbrating".to_owned(), analyzer.anime_consumer()),
            ("wd-swinv2-tagger-v3".to_owned(), analyzer.wd_consumer()),
        ]);
        let store = Arc::new(nib_resources::ResourceStore::open(
            &self.resources_directory,
            consumers,
        )?);
        let downloads = Downloads::new(store, self.runtime.clone());
        let app = AppState::new(self, lexicon, downloads, safety);
        app.start_safety_backfill();
        if let Err(error) = app.sdk() {
            // Provider and credential diagnostics may contain secrets; use the public projection.
            tracing::warn!(message = %error.user_message(), "cannot initialize account sampling");
        }
        tracing::info!("application capabilities initialized");
        Ok(app)
    }
}

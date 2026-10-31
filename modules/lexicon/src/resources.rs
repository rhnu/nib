//! Domain-owned vocabulary validation and query snapshots consume generic resource leases.

use std::{
    collections::HashMap,
    fs,
    path::Path,
    sync::{Arc, RwLock},
    time::Instant,
};

use anyhow::{Result, ensure};
use nib_contract::lexicon::{
    LexiconError, LexiconQuery, LexiconSearch, LexiconSearchResult, LexiconStatus,
};
use nib_resources::{Preparation, PreparedResource, ResourceConsumer, ResourceGeneration};

use crate::{
    format::ResourceManifest,
    search::{Snapshot, validate_query},
    semantic::SemanticControl,
};

/// Query state has no knowledge of download URLs, progress or catalog operations.
pub struct LexiconResources {
    state: Arc<RwLock<QueryState>>,
    semantic: Arc<SemanticControl>,
}

impl Default for LexiconResources {
    fn default() -> Self { Self::new(true) }
}

impl LexiconResources {
    /// Construct query state without opening resources or initializing semantic inference.
    #[must_use]
    pub fn new(semantic_enabled: bool) -> Self {
        Self {
            state: Arc::default(),
            semantic: Arc::new(SemanticControl::new(semantic_enabled)),
        }
    }

    /// Retire semantic caches immediately; running native operations release them on completion.
    pub fn set_semantic_enabled(&self, enabled: bool) { self.semantic.set_enabled(enabled); }
}

#[derive(Default)]
struct QueryState {
    active: Option<Arc<Snapshot>>,
    loading: bool,
    error: Option<String>,
}

struct PreparedLexicon {
    state: Arc<RwLock<QueryState>>,
    snapshot: Arc<Snapshot>,
}

impl PreparedResource for PreparedLexicon {
    fn activate(self: Box<Self>) {
        *self
            .state
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = QueryState {
            active: Some(self.snapshot),
            loading: false,
            error: None,
        };
    }
}

impl ResourceConsumer for LexiconResources {
    fn prepare(
        &self,
        generation: Arc<ResourceGeneration>,
        preparation: Preparation,
    ) -> Result<Box<dyn PreparedResource>> {
        let started = Instant::now();
        let manifest: ResourceManifest =
            serde_json::from_slice(&fs::read(generation.directory.join("lexicon.json"))?)?;
        ensure!(
            manifest.id == generation.version,
            "vocabulary/resource version mismatch"
        );
        ensure!(
            generation.components.iter().any(|id| id == "core"),
            "vocabulary core component is missing"
        );
        let semantic = generation.components.iter().any(|id| id == "semantic");
        manifest.validate()?;
        validate_file_declarations(&manifest, &generation.manifest, &generation.components)?;
        let mut snapshot = Snapshot::open(
            &generation.directory,
            manifest,
            generation.generation.clone(),
            semantic,
            Arc::clone(&self.semantic),
        )?;
        if preparation == Preparation::Install {
            snapshot.prepare_semantic()?;
        }
        tracing::info!(
            generation = generation.generation,
            elapsed_ms = started.elapsed().as_millis(),
            semantic,
            "prepared vocabulary resource"
        );
        snapshot.lease = Some(generation);
        Ok(Box::new(PreparedLexicon {
            state: Arc::clone(&self.state),
            snapshot: Arc::new(snapshot),
        }))
    }

    fn deactivate(&self) {
        *self
            .state
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = QueryState::default();
    }

    fn restore_started(&self) {
        let mut state = self
            .state
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.loading = true;
        state.error = None;
    }

    fn restore_failed(&self, error: &str) {
        let mut state = self
            .state
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.loading = false;
        state.error = Some(error.to_owned());
    }
}

impl LexiconSearch for LexiconResources {
    fn search(&self, query: LexiconQuery) -> Result<LexiconSearchResult, LexiconError> {
        validate_query(&query)?;
        let (_, revision) = self.semantic.status();
        let snapshot = self
            .state
            .read()
            .map_err(|_poisoned| {
                LexiconError::Unavailable("vocabulary state lock poisoned".into())
            })?
            .active
            .clone();
        match snapshot {
            Some(snapshot) => {
                let result = snapshot.search(&query, revision);
                let (enabled, current_revision) = self.semantic.status();
                let mut result = if current_revision == revision {
                    result
                } else {
                    // A closed and reopened switch must never publish an old semantic answer.
                    let mut lexical = query;
                    lexical.semantic = false;
                    snapshot.search(&lexical, current_revision)
                }
                .map_err(|error| LexiconError::Failure(error.into()))?;
                result.semantic_available = snapshot.semantic_available() && enabled;
                Ok(result)
            },
            None => Ok(LexiconSearchResult {
                generation: None,
                revision,
                matches: Vec::new(),
                semantic_available: false,
            }),
        }
    }

    fn status(&self) -> Result<LexiconStatus, LexiconError> {
        let state = self.state.read().map_err(|_poisoned| {
            LexiconError::Unavailable("vocabulary state lock poisoned".into())
        })?;
        let active = &state.active;
        let (semantic_enabled, revision) = self.semantic.status();
        Ok(LexiconStatus {
            semantic_enabled,
            revision,
            loading: state.loading,
            error: state.error.clone(),
            generation: active.as_ref().map(|snapshot| snapshot.generation.clone()),
            term_count: active.as_ref().map_or(0, |snapshot| snapshot.count),
            semantic_available: semantic_enabled
                && active
                    .as_ref()
                    .is_some_and(|snapshot| snapshot.semantic_available()),
        })
    }
}

/// Verify a published candidate without downloading or initializing the model runtime.
///
/// # Errors
/// Returns an error for missing, corrupted or incompatible resource files.
pub fn verify_pack(directory: &Path) -> Result<ResourceManifest> {
    Ok(verified_snapshot(directory)?.manifest)
}

/// Read and hash each downloadable file once, then validate the domain snapshot against it.
fn verified_snapshot(directory: &Path) -> Result<Snapshot> {
    let resource: nib_resources::format::ResourceManifest =
        serde_json::from_slice(&fs::read(directory.join("resource.json"))?)?;
    resource.validate()?;
    ensure!(resource.id == "lexicon", "resource is not a vocabulary");
    let components: Vec<_> = resource
        .components
        .iter()
        .map(|component| component.id.clone())
        .collect();
    for file in resource.files(&components) {
        nib_resources::format::verify_file(directory, file)?;
    }
    let manifest: ResourceManifest =
        serde_json::from_slice(&fs::read(directory.join("lexicon.json"))?)?;
    manifest.validate()?;
    ensure!(
        manifest.id == resource.version,
        "vocabulary/resource version mismatch"
    );
    ensure!(
        manifest.semantic.is_some() == components.iter().any(|id| id == "semantic"),
        "vocabulary/resource semantic component mismatch"
    );
    validate_file_declarations(&manifest, &resource, &components)?;
    let snapshot = Snapshot::open(
        directory,
        manifest.clone(),
        manifest.id.clone(),
        manifest.semantic.is_some(),
        Arc::new(SemanticControl::new(true)),
    )?;
    snapshot.prepare_semantic()?;
    Ok(snapshot)
}

/// Inspect a candidate using the same lexical and semantic search as the desktop application.
///
/// # Errors
/// Returns an error if verification, model initialization or the query fails.
pub fn query_pack(directory: &Path, query: &LexiconQuery) -> Result<LexiconSearchResult> {
    validate_query(query)?;
    verified_snapshot(directory)?.search(query, 0)
}

/// The downloader has checked bytes; domain declarations must describe those same files.
fn validate_file_declarations(
    manifest: &ResourceManifest,
    resource: &nib_resources::format::ResourceManifest,
    components: &[String],
) -> Result<()> {
    let semantic = components.iter().any(|id| id == "semantic");
    ensure!(
        components.iter().any(|id| id == "core"),
        "vocabulary core component is missing"
    );
    ensure!(
        !semantic || manifest.semantic.is_some(),
        "semantic component has no vocabulary index"
    );
    let files: HashMap<_, _> = resource
        .files(components)
        .map(|file| (file.path.as_str(), file))
        .collect();
    ensure!(
        files.contains_key("lexicon.json"),
        "vocabulary manifest is not in selected resource files"
    );
    for file in manifest.files(semantic) {
        let verified = files.get(file.path.as_str()).ok_or_else(|| {
            anyhow::anyhow!(
                "vocabulary file {} is not in selected resource files",
                file.path
            )
        })?;
        ensure!(
            verified.bytes == file.bytes && verified.sha256 == file.sha256,
            "vocabulary/resource file declaration mismatch for {}",
            file.path
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests;

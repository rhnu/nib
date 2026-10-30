//! Domain-owned vocabulary validation and query snapshots consume generic resource leases.

use std::{
    fs,
    path::Path,
    sync::{Arc, RwLock},
};

use anyhow::{Result, ensure};
use nib_contract::lexicon::{
    LexiconError, LexiconQuery, LexiconSearch, LexiconSearchResult, LexiconStatus,
};
use nib_resources::{PreparedResource, ResourceConsumer, ResourceGeneration};

use crate::{
    encoder::QueryEncoderPool,
    format::{ResourceManifest, verify_file},
    search::{Snapshot, validate_query},
};

/// Query state has no knowledge of download URLs, progress or catalog operations.
#[derive(Default)]
pub struct LexiconResources {
    active: Arc<RwLock<Option<Arc<Snapshot>>>>,
}

struct PreparedLexicon {
    active: Arc<RwLock<Option<Arc<Snapshot>>>>,
    snapshot: Arc<Snapshot>,
}

impl PreparedResource for PreparedLexicon {
    fn activate(self: Box<Self>) {
        *self
            .active
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(self.snapshot);
    }
}

impl ResourceConsumer for LexiconResources {
    fn prepare(&self, generation: Arc<ResourceGeneration>) -> Result<Box<dyn PreparedResource>> {
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
        for file in manifest.files(semantic) {
            verify_file(&generation.directory, file)?;
        }
        let mut snapshot = Snapshot::open(
            &generation.directory,
            manifest,
            generation.generation.clone(),
            semantic,
            Arc::<QueryEncoderPool>::default(),
        )?;
        snapshot.lease = Some(generation);
        Ok(Box::new(PreparedLexicon {
            active: Arc::clone(&self.active),
            snapshot: Arc::new(snapshot),
        }))
    }

    fn deactivate(&self) {
        *self
            .active
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    }
}

impl LexiconSearch for LexiconResources {
    fn search(&self, query: LexiconQuery) -> Result<LexiconSearchResult, LexiconError> {
        validate_query(&query)?;
        let snapshot = self
            .active
            .read()
            .map_err(|_poisoned| {
                LexiconError::Unavailable("vocabulary state lock poisoned".into())
            })?
            .clone();
        match snapshot {
            Some(snapshot) => snapshot
                .search(&query)
                .map_err(|error| LexiconError::Failure(error.into())),
            None => Ok(LexiconSearchResult {
                generation: None,
                matches: Vec::new(),
                semantic_available: false,
            }),
        }
    }

    fn status(&self) -> Result<LexiconStatus, LexiconError> {
        let active = self.active.read().map_err(|_poisoned| {
            LexiconError::Unavailable("vocabulary state lock poisoned".into())
        })?;
        Ok(LexiconStatus {
            generation: active.as_ref().map(|snapshot| snapshot.generation.clone()),
            term_count: active.as_ref().map_or(0, |snapshot| snapshot.count),
            semantic_available: active
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
    for file in manifest.files(true) {
        verify_file(directory, file)?;
    }
    Snapshot::open(
        directory,
        manifest.clone(),
        manifest.id.clone(),
        manifest.semantic.is_some(),
        Arc::default(),
    )?;
    Ok(manifest)
}

/// Inspect a candidate using the same lexical and semantic search as the desktop application.
///
/// # Errors
/// Returns an error if verification, model initialization or the query fails.
pub fn query_pack(directory: &Path, query: &LexiconQuery) -> Result<LexiconSearchResult> {
    validate_query(query)?;
    let manifest = verify_pack(directory)?;
    Snapshot::open(
        directory,
        manifest.clone(),
        manifest.id.clone(),
        manifest.semantic.is_some(),
        Arc::default(),
    )?
    .search(query)
}

#[cfg(test)]
mod tests;

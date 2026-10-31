//! The semantic switch retires per-generation contexts without waiting on native operations.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    sync::{
        Arc, Mutex, OnceLock, Weak,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

use anyhow::{Context as _, Result, ensure};
use nib_contract::lexicon::LexiconKind;
use rusqlite::{Connection, OpenFlags};

use crate::{encoder::QueryEncoderPool, format::ResourceManifest, index::FlatIndex};

pub(crate) struct SemanticControl {
    state: Mutex<SemanticState>,
}

struct SemanticState {
    enabled: bool,
    revision: u32,
    slots: Vec<Weak<SemanticSlot>>,
}

#[derive(Default)]
pub(crate) struct SemanticSlot {
    runtime: Mutex<Option<Arc<SemanticRuntime>>>,
}

/// Requests keep a retired context alive only until their current native operation finishes.
pub(crate) struct SemanticRuntime {
    cancelled: AtomicBool,
    index: OnceLock<Result<SemanticSnapshot, SemanticLoadError>>,
    pub(crate) encoder: QueryEncoderPool,
}

#[derive(Debug, Clone, thiserror::Error)]
#[error("semantic vocabulary initialization failed")]
struct SemanticLoadError(#[source] Arc<dyn std::error::Error + Send + Sync>);

pub(crate) struct SemanticSnapshot {
    pub(crate) index: FlatIndex,
    pub(crate) kinds: HashMap<String, LexiconKind>,
    pub(crate) indexed_kinds: Vec<LexiconKind>,
}

impl SemanticControl {
    pub(crate) fn new(enabled: bool) -> Self {
        Self {
            state: Mutex::new(SemanticState {
                enabled,
                revision: 0,
                slots: Vec::new(),
            }),
        }
    }

    pub(crate) fn status(&self) -> (bool, u32) {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (state.enabled, state.revision)
    }

    pub(crate) fn set_enabled(&self, enabled: bool) {
        let mut retired = Vec::new();
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if state.enabled == enabled {
            return;
        }
        state.enabled = enabled;
        state.revision = state.revision.wrapping_add(1);
        state.slots.retain(|slot| {
            let Some(slot) = slot.upgrade() else {
                return false;
            };
            let mut cached = slot
                .runtime
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(runtime) = cached.take() {
                runtime.cancelled.store(true, Ordering::Release);
                retired.push(runtime);
            }
            true
        });
        tracing::info!(
            enabled,
            revision = state.revision,
            "changed vocabulary semantic switch"
        );
        drop(state);
        drop(retired);
    }

    pub(crate) fn slot(&self) -> Arc<SemanticSlot> {
        let slot = Arc::new(SemanticSlot::default());
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.slots.retain(|slot| slot.strong_count() != 0);
        state.slots.push(Arc::downgrade(&slot));
        slot
    }

    pub(crate) fn runtime(
        &self,
        slot: &SemanticSlot,
        revision: u32,
    ) -> Option<Arc<SemanticRuntime>> {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !state.enabled || state.revision != revision {
            return None;
        }
        let mut cached = slot
            .runtime
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        Some(Arc::clone(cached.get_or_insert_with(|| {
            Arc::new(SemanticRuntime {
                cancelled: AtomicBool::new(false),
                index: OnceLock::new(),
                encoder: QueryEncoderPool::default(),
            })
        })))
    }
}

impl SemanticRuntime {
    pub(crate) fn active(&self) -> bool { !self.cancelled.load(Ordering::Acquire) }

    /// Installation retains domain validation while respecting cancellation between stages.
    pub(crate) fn prepare(
        &self,
        directory: &Path,
        manifest: &ResourceManifest,
        generation: &str,
    ) -> Result<()> {
        if !self.active() {
            return Ok(());
        }
        let result = crate::encoder::tokenizer_bytes(
            directory,
            manifest.model.as_ref().context("query model is missing")?,
        );
        if !self.active() {
            return Ok(());
        }
        result?;
        self.snapshot(directory, manifest, generation)?;
        Ok(())
    }

    pub(crate) fn snapshot(
        &self,
        directory: &Path,
        manifest: &ResourceManifest,
        generation: &str,
    ) -> Result<Option<&SemanticSnapshot>> {
        self.initialize(|| {
            let started = Instant::now();
            let result = load_semantic(directory, manifest, || self.active());
            if self.active() {
                match &result {
                    Ok(_) => tracing::info!(
                        generation,
                        elapsed_ms = started.elapsed().as_millis(),
                        "prepared vocabulary semantic snapshot"
                    ),
                    Err(error) => tracing::warn!(
                        generation,
                        elapsed_ms = started.elapsed().as_millis(),
                        ?error,
                        "failed to prepare vocabulary semantic snapshot"
                    ),
                }
            } else {
                tracing::debug!(
                    generation,
                    elapsed_ms = started.elapsed().as_millis(),
                    "cancelled vocabulary semantic preparation"
                );
            }
            result
        })
    }

    fn initialize(
        &self,
        load: impl FnOnce() -> Result<SemanticSnapshot>,
    ) -> Result<Option<&SemanticSnapshot>> {
        if !self.active() {
            return Ok(None);
        }
        let result = self.index.get_or_init(|| {
            let result = if self.active() {
                load()
            } else {
                Err(anyhow::anyhow!("semantic request was cancelled"))
            };
            result.map_err(|error| SemanticLoadError(Arc::from(error.into_boxed_dyn_error())))
        });
        if !self.active() {
            return Ok(None);
        }
        result
            .as_ref()
            .map(Some)
            .map_err(|error| anyhow::Error::new(error.clone()))
    }
}

fn load_semantic(
    directory: &Path,
    manifest: &ResourceManifest,
    active: impl Fn() -> bool,
) -> Result<SemanticSnapshot> {
    let resource = manifest
        .semantic
        .as_ref()
        .context("semantic resource is missing")?;
    ensure!(active(), "semantic request was cancelled");
    let bytes = fs::read(directory.join(&resource.keys.path))?;
    ensure!(active(), "semantic request was cancelled");
    let keys: Vec<String> = serde_json::from_slice(&bytes)?;
    ensure!(active(), "semantic request was cancelled");
    let index = FlatIndex::load(&directory.join(&resource.vectors.path), keys)?;
    ensure!(active(), "semantic request was cancelled");
    let connection = Connection::open_with_flags(
        directory.join(&manifest.core.path),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    ensure!(active(), "semantic request was cancelled");
    let mut statement = connection.prepare("SELECT key,kind FROM terms")?;
    let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    let kinds = indexed_kinds(&index.keys, rows)?;
    let mut indexed_kinds = Vec::new();
    for kind in kinds.values() {
        if !indexed_kinds.contains(kind) {
            indexed_kinds.push(*kind);
        }
    }
    Ok(SemanticSnapshot {
        index,
        kinds,
        indexed_kinds,
    })
}

/// Map one database scan to vector identities, rejecting absent and invalid indexed terms.
fn indexed_kinds(
    keys: &[String],
    rows: impl IntoIterator<Item = rusqlite::Result<(String, String)>>,
) -> Result<HashMap<String, LexiconKind>> {
    let keys: HashSet<_> = keys.iter().map(String::as_str).collect();
    let mut kinds = HashMap::with_capacity(keys.len());
    for row in rows {
        let (key, kind) = row?;
        if keys.contains(key.as_str()) {
            let kind = serde_json::from_value(serde_json::Value::String(kind))?;
            kinds.insert(key, kind);
        }
    }
    if let Some(key) = keys.iter().find(|key| !kinds.contains_key(**key)) {
        anyhow::bail!("index references missing term {key}");
    }
    Ok(kinds)
}

#[cfg(test)]
mod tests;

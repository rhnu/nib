//! Reclaim download objects after the catalog and active installations release them.

use std::{collections::HashSet, fs};

use anyhow::Result;

use super::{ResourceStore, State, format::valid_hash};

impl ResourceStore {
    pub(super) fn reclaim_cache(&self) {
        if let Err(error) = self.reclaim_cache_inner() {
            tracing::warn!(error = ?error, "could not reclaim unused resource download objects");
        }
    }

    fn reclaim_cache_inner(&self) -> Result<()> {
        // A refresh publishes its manifests only after fetching all of them. Wait
        // until that publication completes before deciding which objects are live.
        let _refresh = self
            .refreshing
            .lock()
            .map_err(|_poisoned| anyhow::anyhow!("catalog lock poisoned"))?;
        // Downloads acquire the cache lock before consulting state. Keep that order,
        // and retain in-flight manifests when refresh overlaps an installation.
        let _cache = self
            .cache
            .lock()
            .map_err(|_poisoned| anyhow::anyhow!("resource cache lock poisoned"))?;
        let state = self.lock()?;
        let Some(retained) = retained_objects(&state) else {
            return Ok(());
        };
        let mut removed = 0_u64;
        for entry in fs::read_dir(self.directory.join("objects"))? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if let Some(digest) = object_digest(name)
                && !retained.contains(digest)
            {
                fs::remove_file(entry.path())?;
                removed += 1;
            }
        }
        if removed > 0 {
            tracing::info!(removed, "reclaimed unused resource download objects");
        }
        Ok(())
    }
}

/// Unknown catalog state preserves all objects instead of treating them as unused.
fn retained_objects(state: &State) -> Option<HashSet<&str>> {
    if state.catalog_error.is_some() {
        return None;
    }
    let mut retained = HashSet::new();
    for (resource, manifest) in &state.catalog {
        retained.insert(resource.manifest.sha256.as_str());
        for component in &manifest.components {
            retained.extend(component.files.iter().map(|file| file.sha256.as_str()));
        }
    }
    for installed in state.installed.values() {
        retained.insert(installed.record.resource.manifest.sha256.as_str());
        retained.extend(
            installed
                .record
                .manifest
                .files(&installed.record.components)
                .map(|file| file.sha256.as_str()),
        );
    }
    if let Some((resource, manifest, components)) = &state.task_manifest {
        retained.insert(resource.manifest.sha256.as_str());
        retained.extend(manifest.files(components).map(|file| file.sha256.as_str()));
    }
    Some(retained)
}

fn object_digest(name: &str) -> Option<&str> {
    let digest = name
        .strip_suffix(".part")
        .or_else(|| name.strip_suffix(".etag"))
        .unwrap_or(name);
    valid_hash(digest).then_some(digest)
}

#[cfg(test)]
mod tests;

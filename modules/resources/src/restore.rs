//! Metadata recovery stays cheap; background restoration verifies and prepares each generation.

use std::{
    sync::{Arc, atomic::AtomicBool},
    time::Instant,
};

use anyhow::{Result, ensure};

use crate::{
    Installed, InstalledResource, Preparation, PreparedResource, ResourceError, ResourceGeneration,
    ResourceStore, Restoration,
    format::{valid_hash, verify_file},
    validate_identity,
};

impl ResourceStore {
    pub(super) fn restore_metadata(&self, record: InstalledResource) {
        let id = record.manifest.id.clone();
        let result = (|| -> Result<()> {
            validate_identity(&record.resource, &record.manifest)?;
            record.resource.manifest.validate()?;
            ensure!(
                valid_hash(&record.generation),
                "invalid installed generation"
            );
            ensure!(
                record.manifest.selection(&record.components)? == record.components,
                "invalid installed component selection"
            );
            let lease = Arc::new(ResourceGeneration {
                directory: self.directory.join("packs").join(&record.generation),
                id: record.manifest.id.clone(),
                version: record.manifest.version.clone(),
                components: record.components.clone(),
                generation: record.generation.clone(),
                manifest: record.manifest.clone(),
                retired: AtomicBool::new(false),
            });
            let mut state = self.lock()?;
            ensure!(
                !state.installed.contains_key(&lease.id),
                "duplicate installed resource"
            );
            if let Some(consumer) = self.consumers.get(&lease.id) {
                consumer.restore_started();
            }
            state.installed.insert(
                lease.id.clone(),
                Installed {
                    record,
                    lease,
                    restoration: Restoration::Pending,
                },
            );
            Ok(())
        })();
        if let Err(error) = result {
            self.record_startup_error(format!("{id}: {error:#}"));
        }
    }

    /// Verify and prepare pending installations on an application-owned blocking worker.
    /// Each installed generation is claimed once; concurrent calls skip claimed work.
    ///
    /// # Errors
    /// Returns an error if shared state cannot be accessed. Individual resource failures
    /// are retained in restore status and reported to the matching consumer.
    pub fn restore_installed(&self) -> Result<(), ResourceError> {
        let leases = {
            let mut state = self.lock()?;
            let mut leases = Vec::new();
            for installed in state.installed.values_mut() {
                if !matches!(installed.restoration, Restoration::Pending) {
                    continue;
                }
                installed.restoration = Restoration::Loading;
                leases.push(Arc::clone(&installed.lease));
            }
            leases
        };
        for lease in leases {
            // Domain preparation and large file reads never hold the state lock.
            let started = Instant::now();
            let result = self.prepare_restore(&lease);
            let activated = self.finish_restore(&lease, result)?;
            tracing::info!(
                resource = %lease.id,
                generation = %lease.generation,
                elapsed_ms = started.elapsed().as_millis(),
                activated,
                "finished resource restoration"
            );
        }
        self.reclaim_cache();
        Ok(())
    }

    /// Publish a failed application worker for unfinished current generations.
    ///
    /// # Errors
    /// Returns an error if shared state cannot be accessed.
    pub fn restore_worker_failed(&self, message: &str) -> Result<(), ResourceError> {
        let mut state = self.lock()?;
        for (id, installed) in &mut state.installed {
            if !matches!(
                installed.restoration,
                Restoration::Pending | Restoration::Loading
            ) {
                continue;
            }
            if let Some(consumer) = self.consumers.get(id) {
                consumer.restore_failed(message);
            }
            installed.restoration = Restoration::Failed(message.to_owned());
        }
        Ok(())
    }

    fn prepare_restore(
        &self,
        lease: &Arc<ResourceGeneration>,
    ) -> Result<Option<Box<dyn PreparedResource>>> {
        let started = Instant::now();
        let mut bytes = 0_u64;
        let mut files = 0_u64;
        for file in lease.manifest.files(&lease.components) {
            verify_file(&lease.directory, file)?;
            bytes += file.bytes;
            files += 1;
        }
        tracing::debug!(resource = %lease.id, files, bytes, elapsed_ms = started.elapsed().as_millis(), "verified installed resource files");
        let started = Instant::now();
        let prepared = self
            .consumers
            .get(&lease.id)
            .map(|consumer| consumer.prepare(Arc::clone(lease), Preparation::Restore))
            .transpose()?;
        tracing::debug!(resource = %lease.id, elapsed_ms = started.elapsed().as_millis(), "prepared restored resource consumer");
        Ok(prepared)
    }

    fn finish_restore(
        &self,
        lease: &Arc<ResourceGeneration>,
        result: Result<Option<Box<dyn PreparedResource>>>,
    ) -> Result<bool> {
        let mut state = self.lock()?;
        let Some(installed) = state.installed.get_mut(&lease.id) else {
            return Ok(false);
        };
        // Installation or uninstall may have won while verification ran. The lease identity
        // also rejects replacing a generation with another object carrying the same name.
        if !Arc::ptr_eq(&installed.lease, lease)
            || !matches!(installed.restoration, Restoration::Loading)
        {
            return Ok(false);
        }
        match result {
            Ok(prepared) => {
                if let Some(prepared) = prepared {
                    prepared.activate();
                }
                installed.restoration = Restoration::Ready;
                Ok(true)
            },
            Err(error) => {
                let message = format!("{error:#}");
                tracing::error!(resource = %lease.id, generation = %lease.generation, error = ?error, "resource restoration failed");
                if let Some(consumer) = self.consumers.get(&lease.id) {
                    consumer.restore_failed(&message);
                }
                installed.restoration = Restoration::Failed(message);
                Ok(false)
            },
        }
    }
}

#[cfg(test)]
mod tests;

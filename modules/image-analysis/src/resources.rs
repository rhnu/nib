//! Activation opens models before the generic store publishes a new resource generation.

use std::sync::Arc;

use nib_resources::{PreparedResource, ResourceConsumer, ResourceGeneration};

use crate::{Active, model::Snapshot};

pub(crate) struct AnalysisConsumer {
    active: Active,
    wd: bool,
}

impl AnalysisConsumer {
    pub(crate) const fn new(active: Active, wd: bool) -> Self { Self { active, wd } }
}

struct PreparedAnalysis {
    active: Active,
    snapshot: Arc<Snapshot>,
}

impl PreparedResource for PreparedAnalysis {
    fn activate(self: Box<Self>) {
        let identity = self.snapshot.identity();
        *self
            .active
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(self.snapshot);
        tracing::info!(
            version = identity.version,
            generation = identity.generation,
            revision = identity.revision,
            "activated image analysis model"
        );
    }
}

impl ResourceConsumer for AnalysisConsumer {
    fn prepare(
        &self,
        generation: Arc<ResourceGeneration>,
    ) -> anyhow::Result<Box<dyn PreparedResource>> {
        let snapshot = Snapshot::load(generation, self.wd)?;
        Ok(Box::new(PreparedAnalysis {
            active: Arc::clone(&self.active),
            snapshot: Arc::new(snapshot),
        }))
    }

    fn deactivate(&self) {
        *self
            .active
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        tracing::info!(wd = self.wd, "deactivated image analysis model");
    }
}

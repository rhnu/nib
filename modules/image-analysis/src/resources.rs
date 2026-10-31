//! Restoration publishes model metadata; installation validates inference before activation.

use std::sync::Arc;

use nib_resources::{Preparation, PreparedResource, ResourceConsumer, ResourceGeneration};

use crate::{Active, ResourceState, model::Snapshot};

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
            .unwrap_or_else(std::sync::PoisonError::into_inner) = ResourceState {
            snapshot: Some(self.snapshot),
            loading: false,
            error: None,
        };
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
        preparation: Preparation,
    ) -> anyhow::Result<Box<dyn PreparedResource>> {
        let snapshot = Snapshot::open(generation, self.wd)?;
        if preparation == Preparation::Install {
            snapshot.initialize()?;
        }
        Ok(Box::new(PreparedAnalysis {
            active: Arc::clone(&self.active),
            snapshot: Arc::new(snapshot),
        }))
    }

    fn restore_started(&self) {
        let mut state = self
            .active
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.loading = true;
        state.error = None;
    }

    fn restore_failed(&self, error: &str) {
        let mut state = self
            .active
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.loading = false;
        state.error = Some(error.to_owned());
    }

    fn deactivate(&self) {
        *self
            .active
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = ResourceState::default();
        tracing::info!(wd = self.wd, "deactivated image analysis model");
    }
}

//! Native image rating and tag inference using downloadable immutable model generations.

mod model;
mod preprocess;
mod resources;

use std::sync::{Arc, RwLock};

use model::Snapshot;
use nib_resources::ResourceConsumer;

pub const ANIME_RESOURCE_ID: &str = "anime-dbrating";
pub const WD_RESOURCE_ID: &str = "wd-swinv2-tagger-v3";
pub const ANIME_REVISION: &str = "7af21db648acdeb74f5c334abda9dd7403407b3c";
pub const WD_REVISION: &str = "627aef95638667ddcaa3ac8ae625e88ea5b02f51";

/// Probabilities in the models' four Danbooru rating categories.
#[derive(Debug, Clone, Copy)]
pub struct RawRatingScores {
    pub general: f32,
    pub sensitive: f32,
    pub questionable: f32,
    pub explicit: f32,
}

/// A WD tag before application thresholds and `NovelAI` prompt adaptation.
#[derive(Debug, Clone)]
pub struct RawTag {
    pub name: String,
    pub confidence: f32,
}

/// WD outputs retain general and character categories independently.
#[derive(Debug, Clone)]
pub struct RawWdAnalysis {
    pub ratings: RawRatingScores,
    pub general: Vec<RawTag>,
    pub characters: Vec<RawTag>,
}

/// Identifies the exact installed generation held throughout an inference request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelIdentity {
    pub version: String,
    pub generation: String,
    pub revision: String,
}

/// Classified failures remain available to the application's safety policy.
#[derive(Debug, thiserror::Error)]
pub enum AnalysisError {
    #[error("image analysis resource {0} is unavailable")]
    Unavailable(&'static str),
    #[error("image decoding failed")]
    InvalidImage(#[source] image::ImageError),
    #[error("invalid image analysis resource: {0}")]
    InvalidResource(String),
    #[error("could not read image analysis resource")]
    ResourceIo(#[from] std::io::Error),
    #[error("invalid WD tag metadata")]
    Csv(#[from] csv::Error),
    #[error("invalid anime rating metadata")]
    Json(#[from] serde_json::Error),
    #[error("inference runtime is unavailable")]
    Runtime(#[from] nib_inference_runtime::RuntimeError),
    #[error("ONNX model operation failed")]
    Inference(#[from] ort::Error),
    #[error("image analysis model initialization failed")]
    Initialization(#[source] Arc<Self>),
    #[error("invalid model output: {0}")]
    InvalidOutput(String),
    #[error("image analysis state is unavailable")]
    State,
}

type Active = Arc<RwLock<ResourceState>>;

#[derive(Default)]
struct ResourceState {
    snapshot: Option<Arc<Snapshot>>,
    loading: bool,
    error: Option<String>,
}

/// Resource recovery and runtime initialization remain visible without loading a model.
pub struct ModelStatus {
    pub identity: Option<ModelIdentity>,
    pub loading: bool,
    pub error: Option<String>,
}

/// Shared inference access with independently replaceable anime and WD resources.
#[derive(Default)]
pub struct ImageAnalyzer {
    anime: Active,
    wd: Active,
}

impl ImageAnalyzer {
    /// Construct an analyzer without initializing models or downloading resources.
    #[must_use]
    pub fn new() -> Self { Self::default() }

    /// Consumer for the anime rating resource registered with the resource store.
    #[must_use]
    pub fn anime_consumer(&self) -> Arc<dyn ResourceConsumer> {
        Arc::new(resources::AnalysisConsumer::new(
            Arc::clone(&self.anime),
            false,
        ))
    }

    /// Consumer for the optional WD tag resource registered with the resource store.
    #[must_use]
    pub fn wd_consumer(&self) -> Arc<dyn ResourceConsumer> {
        Arc::new(resources::AnalysisConsumer::new(Arc::clone(&self.wd), true))
    }

    /// Current anime resource identity, without loading or running inference.
    ///
    /// # Errors
    /// Returns a poisoned state lock failure.
    pub fn anime_identity(&self) -> Result<Option<ModelIdentity>, AnalysisError> {
        identity(&self.anime)
    }

    /// Current optional WD resource identity.
    ///
    /// # Errors
    /// Returns a poisoned state lock failure.
    pub fn wd_identity(&self) -> Result<Option<ModelIdentity>, AnalysisError> { identity(&self.wd) }

    /// Reports primary model recovery and lazy initialization without waiting for inference.
    /// # Errors
    /// Returns a poisoned shared-state lock failure.
    pub fn anime_status(&self) -> Result<ModelStatus, AnalysisError> { status(&self.anime) }

    /// Reports optional WD model recovery and lazy initialization without waiting for inference.
    /// # Errors
    /// Returns a poisoned shared-state lock failure.
    pub fn wd_status(&self) -> Result<ModelStatus, AnalysisError> { status(&self.wd) }

    /// Run the primary anime classifier, keeping the model generation leased.
    ///
    /// # Errors
    /// Returns unavailable, invalid input, runtime or inference failures.
    pub fn anime_scores(
        &self,
        bytes: &[u8],
    ) -> Result<(RawRatingScores, ModelIdentity), AnalysisError> {
        let snapshot = snapshot(&self.anime, ANIME_RESOURCE_ID)?;
        let scores = snapshot.anime_scores(bytes)?;
        Ok((scores, snapshot.identity()))
    }

    /// Run WD ratings and general/character tag probabilities on the same image.
    ///
    /// # Errors
    /// Returns unavailable, invalid input, runtime or inference failures.
    pub fn wd_analysis(
        &self,
        bytes: &[u8],
    ) -> Result<(RawWdAnalysis, ModelIdentity), AnalysisError> {
        let snapshot = snapshot(&self.wd, WD_RESOURCE_ID)?;
        let scores = snapshot.wd_analysis(bytes)?;
        Ok((scores, snapshot.identity()))
    }

    /// Run only WD rating extraction without allocating general or character results.
    ///
    /// # Errors
    /// Returns unavailable, invalid input, runtime or inference failures.
    pub fn wd_scores(
        &self,
        bytes: &[u8],
    ) -> Result<(RawRatingScores, ModelIdentity), AnalysisError> {
        let snapshot = snapshot(&self.wd, WD_RESOURCE_ID)?;
        let scores = snapshot.wd_scores(bytes)?;
        Ok((scores, snapshot.identity()))
    }
}

fn identity(active: &Active) -> Result<Option<ModelIdentity>, AnalysisError> {
    Ok(active
        .read()
        .map_err(|_poisoned| AnalysisError::State)?
        .snapshot
        .as_ref()
        .map(|snapshot| snapshot.identity()))
}

fn status(active: &Active) -> Result<ModelStatus, AnalysisError> {
    let state = active.read().map_err(|_poisoned| AnalysisError::State)?;
    let (loading, error) = state
        .snapshot
        .as_ref()
        .map(|snapshot| snapshot.load_status())
        .transpose()?
        .unwrap_or_default();
    Ok(ModelStatus {
        identity: state.snapshot.as_ref().map(|snapshot| snapshot.identity()),
        loading: state.loading || loading,
        error: state.error.clone().or(error),
    })
}

fn snapshot(active: &Active, id: &'static str) -> Result<Arc<Snapshot>, AnalysisError> {
    active
        .read()
        .map_err(|_poisoned| AnalysisError::State)?
        .snapshot
        .clone()
        .ok_or(AnalysisError::Unavailable(id))
}

#[cfg(test)]
mod tests;

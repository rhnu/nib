//! Text-only `EmbeddingGemma` 2 query encoding with the same contract as the offline pipeline.

use std::{
    collections::VecDeque,
    fs::File,
    io::Read as _,
    path::Path,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use anyhow::{Context as _, Result, ensure};
use ort::{session::Session, value::Tensor};
use sha2::{Digest as _, Sha256};
use tokenizers::{Tokenizer, TruncationParams};

use crate::{
    format::{DIMENSION, EncoderContract, ModelResource, hex_digest},
    index::normalize,
};

pub(crate) struct QueryEncoder {
    session: Session,
    tokenizer: Tokenizer,
    contract: EncoderContract,
    cache: VecDeque<(String, Vec<f32>)>,
}

/// All resource generations reuse the same query session when its input contract is unchanged.
#[derive(Default)]
pub(crate) struct QueryEncoderPool {
    current: Mutex<Option<QueryEncoder>>,
    request: AtomicU64,
}

impl QueryEncoderPool {
    pub(crate) fn encode(
        &self,
        directory: &Path,
        model: &ModelResource,
        text: &str,
    ) -> Result<Option<Vec<f32>>> {
        let request = self.request.fetch_add(1, Ordering::AcqRel) + 1;
        let mut current = self
            .current
            .lock()
            .map_err(|_state| anyhow::anyhow!("query encoder lock poisoned"))?;
        if self.request.load(Ordering::Acquire) != request {
            return Ok(None);
        }
        let matches = current.as_ref().is_some_and(|encoder| {
            let old = &encoder.contract;
            let new = &model.contract;
            old.query_model_sha256 == new.query_model_sha256
                && old.tokenizer_sha256 == new.tokenizer_sha256
                && old.query_prefix == new.query_prefix
                && old.max_tokens == new.max_tokens
        });
        if !matches {
            *current = Some(QueryEncoder::load(directory, model)?);
        }
        Ok(Some(
            current
                .as_mut()
                .context("query encoder unavailable")?
                .encode(text)?,
        ))
    }
}

impl QueryEncoder {
    pub(crate) fn load(directory: &Path, model: &ModelResource) -> Result<Self> {
        let environment = environment()?;
        let session = Session::builder(&environment)?
            .with_intra_threads(4)
            .map_err(ort::Error::<()>::from)?
            .with_inter_threads(1)
            .map_err(ort::Error::<()>::from)?
            .commit_from_file(directory.join(&model.graph))?;
        let tokenizer_bytes = tokenizer_bytes(directory, model)?;
        let mut tokenizer =
            Tokenizer::from_bytes(&tokenizer_bytes).map_err(anyhow::Error::from_boxed)?;
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: model.contract.max_tokens,
                ..Default::default()
            }))
            .map_err(anyhow::Error::from_boxed)?;
        tokenizer.with_padding(None);
        tracing::info!(
            contract = model.contract.id,
            "initialized CPU query encoder"
        );
        Ok(Self {
            session,
            tokenizer,
            contract: model.contract.clone(),
            cache: VecDeque::new(),
        })
    }

    pub(crate) fn encode(&mut self, text: &str) -> Result<Vec<f32>> {
        if let Some((_, vector)) = self.cache.iter().find(|(cached, _)| cached == text) {
            return Ok(vector.clone());
        }
        let input = format!("{}{text}", self.contract.query_prefix);
        let encoding = self
            .tokenizer
            .encode(input, true)
            .map_err(anyhow::Error::from_boxed)?;
        let ids = encoding
            .get_ids()
            .iter()
            .map(|value| i64::from(*value))
            .collect::<Vec<_>>();
        let mask = encoding
            .get_attention_mask()
            .iter()
            .map(|value| i64::from(*value))
            .collect::<Vec<_>>();
        let length = ids.len();
        let output = self.session.run(ort::inputs![
            "input_ids" => Tensor::from_array(([1,length],ids))?,
            "attention_mask" => Tensor::from_array(([1,length],mask))?,
            "image_features" => Tensor::from_array(([0,512],Vec::<f32>::new()))?,
            "video_features" => Tensor::from_array(([0,512],Vec::<f32>::new()))?,
            "audio_features" => Tensor::from_array(([0,512],Vec::<f32>::new()))?,
        ])?;
        let embedding = output
            .get("sentence_embedding")
            .context("model did not return sentence_embedding")?;
        let (shape, values) = embedding.try_extract_tensor::<f32>()?;
        ensure!(
            shape.as_ref() == [1, 768] && values.len() == 768,
            "unexpected sentence embedding shape"
        );
        let mut vector = values[..DIMENSION].to_vec();
        normalize(&mut vector)?;
        if self.cache.len() == 64 {
            self.cache.pop_front();
        }
        self.cache.push_back((text.to_owned(), vector.clone()));
        Ok(vector)
    }
}

/// ort permits one process environment; resource replacement creates sessions within it.
fn environment() -> Result<ort::environment::Environment> {
    static ENVIRONMENT: Mutex<Option<ort::environment::Environment>> = Mutex::new(None);
    let mut environment = ENVIRONMENT
        .lock()
        .map_err(|_state| anyhow::anyhow!("ONNX environment lock poisoned"))?;
    if let Some(environment) = environment.as_ref() {
        return Ok(environment.clone());
    }
    let initialized = ort::init().build()?;
    *environment = Some(initialized.clone());
    Ok(initialized)
}

/// Validate the compressed tokenizer during activation, without initializing ONNX Runtime.
pub(crate) fn tokenizer_bytes(directory: &Path, model: &ModelResource) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    flate2::read::GzDecoder::new(File::open(directory.join(&model.tokenizer))?)
        .take(64 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= 64 * 1024 * 1024
            && hex_digest(&Sha256::digest(&bytes)) == model.contract.tokenizer_sha256,
        "decompressed tokenizer integrity mismatch"
    );
    Ok(bytes)
}

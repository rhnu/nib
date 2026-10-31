//! Loaded sessions and metadata stay attached to the immutable resource lease.

use std::{
    fs,
    sync::{Arc, Mutex},
};

use nib_resources::ResourceGeneration;
use ort::{
    session::Session,
    value::{Tensor, TensorElementType, ValueType},
};
use serde::Deserialize;

use crate::{
    ANIME_RESOURCE_ID, ANIME_REVISION, AnalysisError, ModelIdentity, RawRatingScores, RawTag,
    RawWdAnalysis, WD_RESOURCE_ID, WD_REVISION,
    preprocess::{ANIME_SIZE, WD_SIZE, anime_tensor, decode_rgb, wd_tensor},
};

pub(crate) struct Snapshot {
    session: Mutex<Session>,
    lease: Arc<ResourceGeneration>,
    wd: Option<WdMetadata>,
}

struct WdMetadata {
    rating_indices: [usize; 4],
    tags: Vec<WdTag>,
    count: usize,
}

struct WdTag {
    index: usize,
    name: String,
    character: bool,
}

#[derive(Deserialize)]
struct WdRow {
    name: String,
    category: u8,
}

#[derive(Deserialize)]
struct AnimeMetadata {
    labels: Vec<String>,
    name: String,
}

impl Snapshot {
    pub(crate) fn load(lease: Arc<ResourceGeneration>, wd: bool) -> Result<Self, AnalysisError> {
        let expected_id = if wd {
            WD_RESOURCE_ID
        } else {
            ANIME_RESOURCE_ID
        };
        let expected_version = if wd { "1.0.0" } else { "1.0.1" };
        if lease.id != expected_id
            || lease.version != expected_version
            || lease.components != ["core"]
        {
            return Err(AnalysisError::InvalidResource(format!(
                "unsupported {expected_id} resource identity, version or components"
            )));
        }
        let metadata = if wd {
            Some(read_wd_metadata(fs::File::open(
                lease.directory.join("selected_tags.csv"),
            )?)?)
        } else {
            let bytes = fs::read(lease.directory.join("meta.json"))?;
            validate_anime_metadata(&bytes)?;
            None
        };
        let environment = nib_inference_runtime::environment()?;
        let session = Session::builder(&environment)?
            .with_intra_threads(4)
            .map_err(ort::Error::<()>::from)?
            .with_inter_threads(1)
            .map_err(ort::Error::<()>::from)?
            .commit_from_file(lease.directory.join("model.onnx"))?;
        let expected_input = if wd {
            [1, 448, 448, 3]
        } else {
            [1, 3, 384, 384]
        };
        let output_count = metadata.as_ref().map_or(4, |metadata| metadata.count);
        validate_session(&session, &expected_input, output_count)?;
        tracing::debug!(
            resource = lease.id,
            version = lease.version,
            "opened CPU image analysis session"
        );
        Ok(Self {
            session: Mutex::new(session),
            lease,
            wd: metadata,
        })
    }

    pub(crate) fn identity(&self) -> ModelIdentity {
        ModelIdentity {
            version: self.lease.version.clone(),
            generation: self.lease.generation.clone(),
            revision: if self.wd.is_some() {
                WD_REVISION
            } else {
                ANIME_REVISION
            }
            .to_owned(),
        }
    }

    pub(crate) fn anime_scores(&self, bytes: &[u8]) -> Result<RawRatingScores, AnalysisError> {
        let image = decode_rgb(bytes)?;
        let tensor = Tensor::from_array((
            [1, 3, ANIME_SIZE as usize, ANIME_SIZE as usize],
            anime_tensor(&image),
        ))?;
        let values = self.run(tensor, 4)?;
        Ok(rating_scores([values[0], values[1], values[2], values[3]]))
    }

    pub(crate) fn wd_analysis(&self, bytes: &[u8]) -> Result<RawWdAnalysis, AnalysisError> {
        let metadata = self
            .wd
            .as_ref()
            .ok_or_else(|| AnalysisError::InvalidResource("WD metadata is absent".into()))?;
        let values = self.wd_values(bytes, metadata.count)?;
        let ratings = rating_scores(metadata.rating_indices.map(|index| values[index]));
        let mut general = Vec::new();
        let mut characters = Vec::new();
        for tag in &metadata.tags {
            let result = RawTag {
                name: tag.name.clone(),
                confidence: values[tag.index],
            };
            if tag.character {
                characters.push(result);
            } else {
                general.push(result);
            }
        }
        Ok(RawWdAnalysis {
            ratings,
            general,
            characters,
        })
    }

    pub(crate) fn wd_scores(&self, bytes: &[u8]) -> Result<RawRatingScores, AnalysisError> {
        let metadata = self
            .wd
            .as_ref()
            .ok_or_else(|| AnalysisError::InvalidResource("WD metadata is absent".into()))?;
        let values = self.wd_values(bytes, metadata.count)?;
        Ok(rating_scores(
            metadata.rating_indices.map(|index| values[index]),
        ))
    }

    fn wd_values(&self, bytes: &[u8], count: usize) -> Result<Vec<f32>, AnalysisError> {
        let image = decode_rgb(bytes)?;
        let tensor = Tensor::from_array((
            [1, WD_SIZE as usize, WD_SIZE as usize, 3],
            wd_tensor(&image),
        ))?;
        self.run(tensor, count)
    }

    fn run(&self, tensor: Tensor<f32>, expected: usize) -> Result<Vec<f32>, AnalysisError> {
        let mut session = self
            .session
            .lock()
            .map_err(|_poisoned| AnalysisError::State)?;
        let outputs = session.run(ort::inputs![tensor])?;
        let output = outputs
            .values()
            .next()
            .ok_or_else(|| AnalysisError::InvalidOutput("model returned no output".into()))?;
        let (shape, values) = output.try_extract_tensor::<f32>()?;
        let expected_dimension = i64::try_from(expected).map_err(|_overflow| {
            AnalysisError::InvalidOutput("output dimension exceeds i64".into())
        })?;
        if shape.as_ref() != [1, expected_dimension] || values.len() != expected {
            return Err(AnalysisError::InvalidOutput(format!(
                "unexpected output shape {shape:?}; expected [1, {expected}]"
            )));
        }
        let mut values = values.to_vec();
        normalize_probabilities(&mut values)?;
        Ok(values)
    }
}

fn validate_session(
    session: &Session,
    expected_input: &[i64; 4],
    expected_output: usize,
) -> Result<(), AnalysisError> {
    if session.inputs().len() != 1 || session.outputs().len() != 1 {
        return Err(AnalysisError::InvalidResource(
            "model must have one input and one output".into(),
        ));
    }
    validate_tensor_type(session.inputs()[0].dtype(), expected_input)?;
    let expected_output = i64::try_from(expected_output).map_err(|_overflow| {
        AnalysisError::InvalidResource("output dimension exceeds i64".into())
    })?;
    validate_tensor_type(session.outputs()[0].dtype(), &[1, expected_output])
}

fn validate_tensor_type(dtype: &ValueType, expected: &[i64]) -> Result<(), AnalysisError> {
    if let ValueType::Tensor {
        ty: TensorElementType::Float32,
        shape,
        ..
    } = dtype
        && shape.len() == expected.len()
        && shape
            .iter()
            .zip(expected)
            .all(|(actual, expected)| *actual == -1 || actual == expected)
    {
        return Ok(());
    }
    Err(AnalysisError::InvalidResource(format!(
        "model tensor type {dtype:?} does not match float32 {expected:?}"
    )))
}

fn validate_anime_metadata(bytes: &[u8]) -> Result<(), AnalysisError> {
    let metadata: AnimeMetadata = serde_json::from_slice(bytes)?;
    if metadata.name != "mobilenetv3_large_100"
        || metadata.labels != ["general", "sensitive", "questionable", "explicit"]
    {
        return Err(AnalysisError::InvalidResource(
            "anime model metadata does not match the pinned classifier".into(),
        ));
    }
    Ok(())
}

fn read_wd_metadata(reader: impl std::io::Read) -> Result<WdMetadata, AnalysisError> {
    let mut reader = csv::Reader::from_reader(reader);
    let mut ratings = [None; 4];
    let mut tags = Vec::new();
    let mut count = 0;
    for (index, row) in reader.deserialize::<WdRow>().enumerate() {
        let row = row?;
        match row.category {
            9 => {
                let rating = match row.name.as_str() {
                    "general" => 0,
                    "sensitive" => 1,
                    "questionable" => 2,
                    "explicit" => 3,
                    _ => {
                        return Err(AnalysisError::InvalidResource(format!(
                            "unknown WD rating {}",
                            row.name
                        )));
                    },
                };
                if ratings[rating].replace(index).is_some() {
                    return Err(AnalysisError::InvalidResource("duplicate WD rating".into()));
                }
            },
            0 | 4 if !row.name.is_empty() => tags.push(WdTag {
                index,
                name: row.name,
                character: row.category == 4,
            }),
            _ => {
                return Err(AnalysisError::InvalidResource(
                    "unsupported or empty WD tag".into(),
                ));
            },
        }
        count += 1;
    }
    let [
        Some(general),
        Some(sensitive),
        Some(questionable),
        Some(explicit),
    ] = ratings
    else {
        return Err(AnalysisError::InvalidResource(
            "WD rating metadata is incomplete".into(),
        ));
    };
    Ok(WdMetadata {
        rating_indices: [general, sensitive, questionable, explicit],
        tags,
        count,
    })
}

fn normalize_probabilities(values: &mut [f32]) -> Result<(), AnalysisError> {
    if values.iter().any(|value| !value.is_finite()) {
        return Err(AnalysisError::InvalidOutput(
            "model probabilities must be finite".into(),
        ));
    }
    for value in values {
        *value = value.clamp(0.0, 1.0);
    }
    Ok(())
}

const fn rating_scores([general, sensitive, questionable, explicit]: [f32; 4]) -> RawRatingScores {
    RawRatingScores {
        general,
        sensitive,
        questionable,
        explicit,
    }
}

#[cfg(test)]
mod tests;

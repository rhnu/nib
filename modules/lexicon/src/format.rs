//! The application and offline packer share one resource and vocabulary format.

use std::path::Path;

use anyhow::{Context as _, Result, ensure};
use nib_app::lexicon::LexiconKind;
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

pub const DIMENSION: usize = 256;
pub const FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncoderContract {
    pub id: String,
    pub dimension: usize,
    pub max_tokens: usize,
    pub query_prefix: String,
    pub document_template: String,
    pub tokenizer_sha256: String,
    pub query_model_sha256: String,
    pub document_model_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelResource {
    pub contract: EncoderContract,
    pub graph: String,
    pub tokenizer: String,
    pub files: Vec<ResourceFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticResource {
    pub contract_id: String,
    pub vectors: ResourceFile,
    pub keys: ResourceFile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRecord {
    pub name: String,
    pub url: String,
    pub revision: String,
    pub license: String,
    pub license_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceManifest {
    pub format_version: u32,
    pub id: String,
    pub core: ResourceFile,
    pub semantic: Option<SemanticResource>,
    pub model: Option<ModelResource>,
    pub sources: Vec<SourceRecord>,
}

impl ResourceManifest {
    pub(crate) fn validate(&self) -> Result<()> {
        ensure!(
            self.format_version == FORMAT_VERSION,
            "unsupported vocabulary format {}",
            self.format_version
        );
        ensure!(
            !self.id.is_empty() && self.id.len() <= 128,
            "invalid resource version"
        );
        let mut paths = std::collections::HashSet::new();
        for file in self.files(true) {
            validate_path(&file.path)?;
            ensure!(
                paths.insert(&file.path),
                "duplicate resource path {}",
                file.path
            );
            ensure!(valid_hash(&file.sha256), "invalid resource digest");
        }
        match (&self.semantic, &self.model) {
            (Some(index), Some(model)) => {
                let contract = &model.contract;
                ensure!(
                    contract.dimension == DIMENSION && contract.max_tokens == 128,
                    "unsupported embedding dimensions or token length"
                );
                ensure!(
                    contract.query_prefix == "task: search result | query: ",
                    "unsupported query encoding prefix"
                );
                ensure!(
                    !contract.id.is_empty() && index.contract_id == contract.id,
                    "model/index contract mismatch"
                );
                ensure!(
                    valid_hash(&contract.tokenizer_sha256)
                        && valid_hash(&contract.query_model_sha256)
                        && valid_hash(&contract.document_model_sha256),
                    "invalid encoder digest"
                );
                ensure!(
                    index.vectors.bytes > 0 && index.vectors.bytes % (DIMENSION as u64 * 2) == 0,
                    "invalid FP16 matrix length"
                );
                let graph = model
                    .files
                    .iter()
                    .find(|file| file.path == model.graph)
                    .context("model graph is missing")?;
                let weights = model
                    .files
                    .iter()
                    .find(|file| file.path == format!("{}_data", model.graph))
                    .context("model external weights are missing")?;
                ensure!(
                    hex_digest(&Sha256::digest(
                        format!("{}:{}", graph.sha256, weights.sha256).as_bytes()
                    )) == contract.query_model_sha256,
                    "query model contract mismatch"
                );
                ensure!(
                    model.files.iter().any(|file| file.path == model.tokenizer),
                    "tokenizer resource missing"
                );
                ensure!(
                    model.tokenizer.ends_with(".json.gz"),
                    "query tokenizer must use gzip"
                );
                validate_path(&model.graph)?;
                validate_path(&model.tokenizer)?;
            },
            (None, None) => {},
            _ => anyhow::bail!("semantic index and query model must be supplied together"),
        }
        Ok(())
    }

    pub(crate) fn files(&self, semantic: bool) -> Vec<&ResourceFile> {
        let mut files = vec![&self.core];
        if semantic {
            if let Some(index) = &self.semantic {
                files.extend([&index.vectors, &index.keys]);
            }
            if let Some(model) = &self.model {
                files.extend(&model.files);
            }
        }
        files
    }
}

/// Imported source fields retain their strength instead of treating every search term as an alias.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedTerm {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub prompt_text: Option<String>,
    pub category: LexiconKind,
    pub translation: Option<String>,
    pub description: Option<String>,
    pub post_count: u32,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub search_terms: Vec<String>,
    #[serde(default)]
    pub groups: Vec<String>,
    pub source: String,
    #[serde(default)]
    pub relations: Vec<ImportedRelation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedRelation {
    pub target_key: String,
    pub kind: String,
    pub score: f32,
}

pub(crate) use nib_resources::format::{file_hash, hex_digest, valid_hash, validate_path};

pub(crate) fn verify_file(directory: &Path, file: &ResourceFile) -> Result<()> {
    let path = directory.join(&file.path);
    ensure!(
        path.metadata()?.len() == file.bytes && file_hash(&path)? == file.sha256,
        "resource integrity mismatch for {}",
        file.path
    );
    Ok(())
}

pub(crate) fn model_fingerprint(graph: &Path) -> Result<String> {
    let weights = graph.with_file_name(format!(
        "{}_data",
        graph
            .file_name()
            .context("model filename")?
            .to_string_lossy()
    ));
    let text = format!("{}:{}", file_hash(graph)?, file_hash(&weights)?);
    Ok(hex_digest(&Sha256::digest(text.as_bytes())))
}

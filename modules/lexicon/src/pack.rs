//! Deterministic vocabulary assembly shared by local data builds and resource CI.

use std::{
    collections::HashSet,
    fs,
    io::{BufRead as _, BufReader},
    path::Path,
};

use anyhow::{Context as _, Result, ensure};
use rusqlite::{Connection, params};
use sha2::Digest as _;

use crate::{
    format::{
        EncoderContract, FORMAT_VERSION, ImportedTerm, ModelResource, ResourceFile,
        ResourceManifest, SemanticResource, file_hash, hex_digest, model_fingerprint,
        validate_path,
    },
    index::FlatIndex,
    search::{kind_name, normalize},
};

/// Assemble already reviewed records and optional embeddings without re-encoding any document.
pub struct PackOptions<'a> {
    pub input: &'a Path,
    pub output: &'a Path,
    pub id: &'a str,
    pub asset_base_url: &'a str,
    pub vectors: Option<&'a Path>,
    pub keys: Option<&'a Path>,
    pub model_dir: Option<&'a Path>,
    pub contract: Option<&'a Path>,
    pub sources_json: Option<&'a Path>,
}

/// Build a vocabulary and its optional matching semantic resources.
///
/// # Errors
/// Returns an error for invalid source records, incompatible embeddings or filesystem failures.
pub fn pack(options: &PackOptions<'_>) -> Result<ResourceManifest> {
    fs::create_dir_all(options.output)?;
    let core_path = options.output.join("lexicon.sqlite3");
    ensure!(
        !core_path.exists(),
        "output already contains a vocabulary; choose a new output directory"
    );
    let keys = build_core(options.input, &core_path)?;
    let asset = |name: &str| -> Result<ResourceFile> {
        let path = options.output.join(name);
        Ok(ResourceFile {
            path: name.to_owned(),
            url: format!("{}/{}", options.asset_base_url.trim_end_matches('/'), name),
            bytes: path.metadata()?.len(),
            sha256: file_hash(&path)?,
        })
    };
    let mut manifest = ResourceManifest {
        format_version: FORMAT_VERSION,
        id: options.id.to_owned(),
        core: asset("lexicon.sqlite3")?,
        semantic: None,
        model: None,
        sources: options
            .sources_json
            .map(|path| -> Result<_> { Ok(serde_json::from_slice(&fs::read(path)?)?) })
            .transpose()?
            .unwrap_or_default(),
    };
    add_semantic(&mut manifest, options, &keys, &asset)?;
    manifest.validate()?;
    fs::write(
        options.output.join("lexicon-manifest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    tracing::info!(
        terms = keys.len(),
        generation = manifest.id,
        "vocabulary resource assembled"
    );
    Ok(manifest)
}

/// Build the immutable SQLite records and their lookup structures.
fn build_core(input: &Path, core_path: &Path) -> Result<HashSet<String>> {
    let mut connection = Connection::open(core_path)?;
    connection.execute_batch(include_str!("schema.sql"))?;
    let transaction = connection.transaction()?;
    let mut keys = HashSet::new();
    let mut relations = Vec::new();
    for line in BufReader::new(fs::File::open(input)?).lines() {
        let term: ImportedTerm = serde_json::from_str(&line?)?;
        ensure!(
            !term.name.trim().is_empty() && term.key == format!("danbooru:{}", term.name),
            "invalid canonical term {}",
            term.key
        );
        ensure!(
            keys.insert(term.key.clone()),
            "duplicate canonical term {}",
            term.key
        );
        transaction.execute(
            "INSERT INTO terms VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                term.key,
                term.name,
                normalize(&term.name),
                kind_name(term.category),
                term.translation,
                term.description,
                term.post_count,
                serde_json::to_string(&term.aliases)?,
                serde_json::to_string(&term.groups)?,
                term.source,
                term.prompt_text
                    .as_deref()
                    .map_or_else(|| term.name.replace('_', " "), str::to_owned),
            ],
        )?;
        for (values, reason) in [(&term.aliases, "alias"), (&term.search_terms, "search")] {
            for value in values {
                transaction.execute(
                    "INSERT INTO lookup VALUES (?1,?2,?3)",
                    params![term.key, normalize(value), reason],
                )?;
            }
        }
        if let Some(translation) = &term.translation {
            transaction.execute(
                "INSERT INTO lookup VALUES (?1,?2,'translation')",
                params![term.key, normalize(translation)],
            )?;
        }
        let text = [
            term.name.as_str(),
            term.translation.as_deref().unwrap_or(""),
            term.description.as_deref().unwrap_or(""),
            &term.aliases.join(" "),
            &term.search_terms.join(" "),
        ]
        .join(" ");
        transaction.execute(
            "INSERT INTO terms_fts VALUES (?1,?2)",
            params![term.key, normalize(&text)],
        )?;
        for relation in term.relations {
            ensure!(relation.score.is_finite(), "non-finite relation score");
            relations.push((term.key.clone(), relation));
        }
    }
    ensure!(!keys.is_empty(), "vocabulary is empty");
    for (source, relation) in relations {
        if keys.contains(&relation.target_key) {
            transaction.execute(
                "INSERT INTO relations VALUES (?1,?2,?3,?4)",
                params![source, relation.target_key, relation.kind, relation.score],
            )?;
        }
    }
    transaction.commit()?;
    connection.execute_batch(
        "INSERT INTO terms_fts(terms_fts) VALUES ('optimize'); PRAGMA optimize; VACUUM;",
    )?;
    drop(connection);
    Ok(keys)
}

/// Attach the query encoder and exactly matching row mapping to the resource manifest.
fn add_semantic(
    manifest: &mut ResourceManifest,
    options: &PackOptions<'_>,
    keys: &HashSet<String>,
    asset: &impl Fn(&str) -> Result<ResourceFile>,
) -> Result<()> {
    match (
        options.vectors,
        options.keys,
        options.model_dir,
        options.contract,
    ) {
        (Some(vectors), Some(key_path), Some(model_dir), Some(contract_path)) => {
            let row_keys: Vec<String> = serde_json::from_slice(&fs::read(key_path)?)?;
            ensure!(
                row_keys.iter().all(|key| keys.contains(key)),
                "semantic index references unknown terms"
            );
            FlatIndex::load(vectors, row_keys)?;
            fs::copy(vectors, options.output.join("vectors.f16"))?;
            fs::copy(key_path, options.output.join("keys.json"))?;
            let mut contract: EncoderContract = serde_json::from_slice(&fs::read(contract_path)?)?;
            // A friendly recipe name is insufficient when either quantized model changes.
            // Fingerprint the complete recorded contract without changing the encoding cache.
            contract.id.clear();
            contract.id = hex_digest(&sha2::Sha256::digest(serde_json::to_vec(&contract)?));
            let mut files = Vec::new();
            let mut graph = None;
            let mut entries = fs::read_dir(model_dir)?.collect::<std::io::Result<Vec<_>>>()?;
            entries.sort_by_key(std::fs::DirEntry::file_name);
            for entry in entries {
                ensure!(
                    entry.file_type()?.is_file(),
                    "model directory must contain files only"
                );
                let name = entry
                    .file_name()
                    .into_string()
                    .map_err(|_name| anyhow::anyhow!("non-unicode model filename"))?;
                if name == "tokenizer.json" {
                    continue;
                }
                validate_path(&name)?;
                ensure!(
                    !options.output.join(&name).exists(),
                    "duplicate model resource filename"
                );
                if Path::new(&name)
                    .extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("onnx"))
                {
                    ensure!(graph.is_none(), "multiple query graphs");
                    graph = Some(name.clone());
                }
                fs::copy(entry.path(), options.output.join(&name))?;
                files.push(asset(&name)?);
            }
            let graph = graph.context("query model graph is missing")?;
            ensure!(
                model_fingerprint(&options.output.join(&graph))? == contract.query_model_sha256,
                "query model fingerprint mismatch"
            );
            manifest.semantic = Some(SemanticResource {
                contract_id: contract.id.clone(),
                vectors: asset("vectors.f16")?,
                keys: asset("keys.json")?,
            });
            manifest.model = Some(ModelResource {
                contract,
                graph,
                tokenizer: "tokenizer.json.gz".to_owned(),
                files,
            });
        },
        (None, None, None, None) => {},
        _ => anyhow::bail!(
            "vectors, keys, model directory and encoder contract must be supplied together"
        ),
    }
    Ok(())
}

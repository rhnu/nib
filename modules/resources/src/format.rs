//! Portable catalog, manifests and content identities shared with resource publishers.

use std::{
    collections::HashSet,
    fs::File,
    io::Read as _,
    path::{Component, Path},
};

use anyhow::{Context as _, Result, ensure};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};

pub const SCHEMA_VERSION: u32 = 1;
pub const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/rhnu/nib/refs/heads/resource/catalog.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceFile {
    pub path: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceComponent {
    pub id: String,
    pub name: String,
    pub description: String,
    pub requires: Vec<String>,
    pub files: Vec<ResourceFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceManifest {
    pub schema_version: u32,
    pub id: String,
    pub version: String,
    pub components: Vec<ResourceComponent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogResource {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub manifest: ResourceFile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub schema_version: u32,
    pub resources: Vec<CatalogResource>,
}

impl ResourceFile {
    /// Check the portable path, canonical digest and HTTPS download URL.
    ///
    /// # Errors
    /// Returns an error for an unsafe filename, malformed digest or invalid download URL.
    pub fn validate(&self) -> Result<()> {
        validate_path(&self.path)?;
        ensure!(valid_hash(&self.sha256), "invalid resource digest");
        validate_url(&self.url)?;
        Ok(())
    }
}

impl Catalog {
    /// Check the catalog schema and unique resource identities.
    ///
    /// # Errors
    /// Returns an error for unsupported schema, duplicate identities, missing versions
    /// or invalid manifest file metadata.
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.schema_version == SCHEMA_VERSION,
            "unsupported catalog schema"
        );
        let mut ids = HashSet::new();
        for resource in &self.resources {
            validate_path(&resource.id)?;
            ensure!(ids.insert(&resource.id), "duplicate resource identity");
            ensure!(!resource.version.is_empty(), "missing resource version");
            resource.manifest.validate()?;
            ensure!(
                resource.manifest.path == "resource.json",
                "invalid manifest path"
            );
        }
        Ok(())
    }
}

impl ResourceManifest {
    /// Check component dependencies and downloadable file identities.
    ///
    /// # Errors
    /// Returns an error for unsupported schema, missing identities or components,
    /// invalid files, conflicting filenames, size overflow or invalid dependency graphs.
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.schema_version == SCHEMA_VERSION,
            "unsupported resource schema"
        );
        validate_path(&self.id)?;
        ensure!(
            !self.version.is_empty() && !self.components.is_empty(),
            "empty resource version or components"
        );
        let mut ids = HashSet::new();
        let mut paths = HashSet::new();
        let mut bytes = 0_u64;
        for component in &self.components {
            validate_path(&component.id)?;
            ensure!(ids.insert(&component.id), "duplicate component identity");
            ensure!(!component.files.is_empty(), "empty component");
            for file in &component.files {
                file.validate()?;
                bytes = bytes
                    .checked_add(file.bytes)
                    .context("resource size overflow")?;
                ensure!(
                    paths.insert(file.path.to_ascii_lowercase()),
                    "duplicate resource path"
                );
            }
        }
        for component in &self.components {
            ensure!(
                component
                    .requires
                    .iter()
                    .all(|id| ids.contains(id) && id != &component.id),
                "invalid component dependency"
            );
            self.visit(&component.id, &mut HashSet::new(), &mut HashSet::new())?;
        }
        Ok(())
    }

    fn visit<'a>(
        &'a self,
        id: &'a str,
        visiting: &mut HashSet<&'a str>,
        selected: &mut HashSet<&'a str>,
    ) -> Result<()> {
        if selected.contains(id) {
            return Ok(());
        }
        ensure!(visiting.insert(id), "cyclic component dependency");
        let component = self
            .components
            .iter()
            .find(|component| component.id == id)
            .context("unknown resource component")?;
        for dependency in &component.requires {
            self.visit(dependency, visiting, selected)?;
        }
        visiting.remove(id);
        selected.insert(id);
        Ok(())
    }

    /// Resolve the exact target selection, including dependencies of the same version.
    ///
    /// # Errors
    /// Returns an error for an empty selection, unknown component or dependency cycle.
    pub fn selection(&self, ids: &[String]) -> Result<Vec<String>> {
        ensure!(!ids.is_empty(), "select at least one component");
        let mut selected = HashSet::new();
        for id in ids {
            self.visit(id, &mut HashSet::new(), &mut selected)?;
        }
        Ok(self
            .components
            .iter()
            .filter(|component| selected.contains(component.id.as_str()))
            .map(|component| component.id.clone())
            .collect())
    }

    pub fn files<'a>(&'a self, selected: &'a [String]) -> impl Iterator<Item = &'a ResourceFile> {
        self.components
            .iter()
            .filter(|component| selected.contains(&component.id))
            .flat_map(|component| &component.files)
    }
}

/// Check that a download URL uses HTTPS with a host and no embedded credentials.
///
/// # Errors
/// Returns an error if the URL cannot be parsed or violates the download URL contract.
pub fn validate_url(value: &str) -> Result<()> {
    let url = reqwest::Url::parse(value)?;
    ensure!(
        url.scheme() == "https"
            && url.host_str().is_some()
            && url.username().is_empty()
            && url.password().is_none(),
        "resource URLs must use HTTPS without credentials"
    );
    Ok(())
}

pub fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

/// Flat portable filenames prevent traversal and Windows device-name interpretation.
///
/// # Errors
/// Returns an error for empty, nonportable, reserved or nonrelative filenames.
pub fn validate_path(path: &str) -> Result<()> {
    ensure!(
        !path.is_empty()
            && !path.starts_with('.')
            && !path.ends_with('.')
            && path
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
            && Path::new(path).components().count() == 1
            && Path::new(path)
                .components()
                .all(|part| matches!(part, Component::Normal(_))),
        "invalid resource path {path}"
    );
    let stem = path.split('.').next().unwrap_or("").to_ascii_uppercase();
    ensure!(
        !matches!(
            stem.as_str(),
            "CON"
                | "PRN"
                | "AUX"
                | "NUL"
                | "COM1"
                | "COM2"
                | "COM3"
                | "COM4"
                | "COM5"
                | "COM6"
                | "COM7"
                | "COM8"
                | "COM9"
                | "LPT1"
                | "LPT2"
                | "LPT3"
                | "LPT4"
                | "LPT5"
                | "LPT6"
                | "LPT7"
                | "LPT8"
                | "LPT9"
        ),
        "reserved resource filename"
    );
    Ok(())
}

/// Read a file and calculate its canonical SHA-256 content identity.
///
/// # Errors
/// Returns an error if the file cannot be opened or read.
pub fn file_hash(path: &Path) -> Result<String> {
    let mut file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hex_digest(&hash.finalize()))
}

pub fn hex_digest(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut text, byte| {
            write!(&mut text, "{byte:02x}").expect("writing a String is infallible");
            text
        })
}

/// Verify a local file against its declared length and content identity.
///
/// # Errors
/// Returns an error if the file cannot be inspected or read, or its length or hash differs.
pub fn verify_file(directory: &Path, file: &ResourceFile) -> Result<()> {
    let path = directory.join(&file.path);
    ensure!(
        path.metadata()?.len() == file.bytes && file_hash(&path)? == file.sha256,
        "resource integrity mismatch for {}",
        file.path
    );
    Ok(())
}

#[cfg(test)]
mod tests;

//! Local verification and resumable publication of immutable resource releases.

use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read as _, Write as _},
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{Context as _, Result, ensure};
use clap::{Args, Subcommand};
use nib_resources::format::{
    Catalog, CatalogResource, ResourceFile, ResourceManifest, SCHEMA_VERSION, file_hash,
    validate_path, verify_file,
};
use reqwest::{blocking::Client, header::CONTENT_LENGTH};
use serde_json::Value;

const REPOSITORY: &str = "rhnu/nib";

#[derive(Subcommand)]
pub enum Task {
    /// Verify a local version and every asset before publication.
    Verify(Identity),
    /// Publish an immutable resource release, then update the resource branch catalog.
    Publish {
        #[command(flatten)]
        identity: Identity,
        #[arg(long)]
        name: String,
        #[arg(long)]
        description: String,
    },
}

#[derive(Args)]
pub struct Identity {
    #[arg(long)]
    id: String,
    #[arg(long, value_parser = parse_version)]
    version: String,
    /// Resource branch worktree; defaults to sibling nib-resource.
    #[arg(long)]
    resource_dir: Option<PathBuf>,
}

struct Package {
    directory: PathBuf,
    tag: String,
    assets: Vec<ResourceFile>,
    manifest: ResourceFile,
    external_files: Vec<ResourceFile>,
}

pub fn run(task: Task) -> Result<()> {
    let (identity, publication) = match task {
        Task::Verify(identity) => (identity, None),
        Task::Publish {
            identity,
            name,
            description,
        } => (identity, Some((name, description))),
    };
    validate_path(&identity.id)?;
    let workspace = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .context("missing workspace root")?;
    let directory = identity
        .resource_dir
        .clone()
        .unwrap_or_else(|| workspace.with_file_name("nib-resource"));
    let directory = directory
        .canonicalize()
        .with_context(|| format!("open resource worktree {}", directory.display()))?;
    let package = verify(&directory, &identity)?;
    println!("Verified {}: {} assets", package.tag, package.assets.len());
    if let Some((name, description)) = publication {
        publish(&directory, &identity, &package, name, description)?;
    }
    Ok(())
}

fn parse_version(value: &str) -> std::result::Result<String, String> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || !part.bytes().all(|byte| byte.is_ascii_digit())
                || (part.len() > 1 && part.starts_with('0'))
        })
    {
        return Err(
            "resource version must use stable major.minor.patch numbers without leading zeros"
                .into(),
        );
    }
    Ok(value.to_owned())
}

fn release_tag(id: &str, version: &str) -> String { format!("resource-{id}-v{version}") }

/// Validate the publication identities before any Git or GitHub mutation.
fn publication_files(
    manifest: &ResourceManifest,
    id: &str,
    version: &str,
) -> Result<Vec<ResourceFile>> {
    manifest.validate()?;
    ensure!(
        manifest.id == id && manifest.version == version,
        "resource manifest identity differs from selected version"
    );
    let base = format!(
        "https://github.com/{REPOSITORY}/releases/download/{}",
        release_tag(id, version)
    );
    let files: Vec<_> = manifest
        .components
        .iter()
        .flat_map(|component| component.files.iter().cloned())
        .collect();
    for file in &files {
        ensure!(
            file.url == format!("{base}/{}", file.path) || is_pinned_model(&file.url),
            "resource URL differs from fixed release target: {}",
            file.path
        );
    }
    Ok(files)
}

/// External models retain an immutable upstream revision and are never uploaded as release assets.
fn is_pinned_model(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    let parts: Vec<_> = url
        .path()
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    url.scheme() == "https"
        && url.host_str() == Some("huggingface.co")
        && url.username().is_empty()
        && url.password().is_none()
        && parts.len() >= 5
        && parts[2] == "resolve"
        && parts[3].len() == 40
        && parts[3].bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Validate upstream bytes before publishing metadata that points to them.
fn verify_external_file(file: &ResourceFile) -> Result<()> {
    let temporary = TemporaryFile::new("upstream")?;
    let client = Client::builder()
        .https_only(true)
        .timeout(Duration::from_mins(30))
        .build()?;
    let response = client.get(&file.url).send()?.error_for_status()?;
    let mut output = File::create(&temporary.path)?;
    let bytes = std::io::copy(
        &mut response.take(file.bytes.saturating_add(1)),
        &mut output,
    )?;
    output.flush()?;
    ensure!(
        bytes == file.bytes && file_hash(&temporary.path)? == file.sha256,
        "upstream resource content differs: {}",
        file.path
    );
    Ok(())
}

fn verify(directory: &Path, identity: &Identity) -> Result<Package> {
    let package = directory
        .join(&identity.id)
        .join("versions")
        .join(&identity.version);
    let manifest: ResourceManifest =
        serde_json::from_slice(&fs::read(package.join("resource.json"))?)?;
    let mut external_files = Vec::new();
    for file in publication_files(&manifest, &identity.id, &identity.version)? {
        if is_pinned_model(&file.url) {
            ensure!(
                !package.join(&file.path).exists(),
                "upstream model must remain external: {}",
                file.path
            );
            verify_external_file(&file)?;
            external_files.push(file);
        } else {
            verify_file(&package, &file)?;
        }
    }
    let tag = release_tag(&identity.id, &identity.version);
    let mut assets = Vec::new();
    for entry in fs::read_dir(&package)? {
        let entry = entry?;
        ensure!(
            entry.file_type()?.is_file(),
            "resource outputs must be flat regular files: {}",
            entry.path().display()
        );
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_filename| anyhow::anyhow!("resource asset filename must be UTF-8"))?;
        validate_path(&name)?;
        assets.push(ResourceFile {
            path: name.clone(),
            url: format!("https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"),
            bytes: entry.metadata()?.len(),
            sha256: file_hash(&entry.path())?,
        });
    }
    assets.sort_by(|left, right| left.path.cmp(&right.path));
    let manifest = assets
        .iter()
        .find(|file| file.path == "resource.json")
        .context("missing resource manifest")?
        .clone();
    Ok(Package {
        directory: package,
        tag,
        assets,
        manifest,
        external_files,
    })
}

fn execute(mut command: Command) -> Result<Output> {
    let diagnostic = format!("{command:?}");
    let output = command
        .output()
        .with_context(|| format!("run {diagnostic}"))?;
    ensure!(
        output.status.success(),
        "{diagnostic} failed: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(output)
}

fn git(directory: &Path, arguments: &[&str]) -> Result<String> {
    let mut command = Command::new("git");
    command.current_dir(directory).args(arguments);
    Ok(String::from_utf8(execute(command)?.stdout)?
        .trim()
        .to_owned())
}

fn gh(arguments: &[&str]) -> Result<Value> {
    let mut command = Command::new("gh");
    command.args(arguments);
    Ok(serde_json::from_slice(&execute(command)?.stdout)?)
}

fn gh_run(arguments: &[&str]) -> Result<()> {
    let mut command = Command::new("gh");
    command.args(arguments);
    execute(command)?;
    Ok(())
}

fn require_worktree(directory: &Path) -> Result<()> {
    ensure!(
        git(directory, &["branch", "--show-current"])? == "resource",
        "publication requires the resource branch worktree"
    );
    ensure!(
        git(directory, &["status", "--porcelain"])?.is_empty(),
        "commit resource worktree changes before publishing"
    );
    let remote = git(directory, &["remote", "get-url", "--push", "origin"])?;
    let remote = remote
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .to_ascii_lowercase();
    ensure!(
        matches!(
            remote.as_str(),
            "https://github.com/rhnu/nib"
                | "git@github.com:rhnu/nib"
                | "ssh://git@github.com/rhnu/nib"
        ),
        "resource origin must point to rhnu/nib"
    );
    Ok(())
}

/// Existing release tags may precede catalog-only commits, but must retain the same package tree.
fn prepare_tag(directory: &Path, identity: &Identity, package: &Package) -> Result<()> {
    let tag_ref = format!("refs/tags/{}", package.tag);
    let remote = git(directory, &["ls-remote", "--tags", "origin", &tag_ref])?;
    if !remote.is_empty() {
        git(
            directory,
            &["fetch", "origin", &format!("{tag_ref}:{tag_ref}")],
        )?;
    }
    let tags = git(directory, &["tag", "--list", &package.tag])?;
    if tags.is_empty() {
        git(directory, &["tag", &package.tag, "HEAD"])?;
    } else {
        ensure!(
            git(directory, &["cat-file", "-t", &tag_ref])? == "commit",
            "resource release tag must be lightweight"
        );
        let path = format!("{}/versions/{}", identity.id, identity.version);
        let current = git(directory, &["rev-parse", &format!("HEAD:{path}")])?;
        let tagged = git(
            directory,
            &["rev-parse", &format!("{}:{path}", package.tag)],
        )?;
        ensure!(
            current == tagged,
            "existing resource tag identifies a different package tree"
        );
    }
    git(directory, &["push", "origin", &tag_ref])?;
    Ok(())
}

/// The paginated list includes drafts and versions older than the first hundred releases.
fn find_release(tag: &str) -> Result<Option<Value>> {
    let pages = gh(&[
        "api",
        &format!("repos/{REPOSITORY}/releases?per_page=100"),
        "--paginate",
        "--slurp",
    ])?;
    let pages = pages.as_array().context("invalid release pages")?;
    for page in pages {
        for release in page.as_array().context("invalid release list")? {
            if release["tag_name"].as_str() == Some(tag) {
                return Ok(Some(release.clone()));
            }
        }
    }
    Ok(None)
}

fn asset_matches(asset: &Value, expected: &ResourceFile) -> Result<()> {
    ensure!(
        asset["size"].as_u64() == Some(expected.bytes),
        "existing asset size conflicts: {}",
        expected.path
    );
    if let Some(digest) = asset["digest"]
        .as_str()
        .and_then(|value| value.strip_prefix("sha256:"))
    {
        ensure!(
            digest == expected.sha256,
            "existing asset digest conflicts: {}",
            expected.path
        );
    } else {
        let id = asset["id"].as_u64().context("missing release asset id")?;
        let temporary = TemporaryFile::new("asset")?;
        let mut command = Command::new("gh");
        command.args([
            "api",
            &format!("repos/{REPOSITORY}/releases/assets/{id}"),
            "-H",
            "Accept: application/octet-stream",
        ]);
        command.stdout(File::create(&temporary.path)?);
        execute(command)?;
        ensure!(
            temporary.path.metadata()?.len() == expected.bytes
                && file_hash(&temporary.path)? == expected.sha256,
            "existing asset content conflicts: {}",
            expected.path
        );
    }
    Ok(())
}

fn verify_assets(release: &Value, package: &Package) -> Result<Vec<String>> {
    let assets = release["assets"]
        .as_array()
        .context("missing release assets")?;
    let mut missing = Vec::new();
    for file in &package.assets {
        if let Some(asset) = assets
            .iter()
            .find(|asset| asset["name"].as_str() == Some(&file.path))
        {
            asset_matches(asset, file)?;
        } else {
            missing.push(file.path.clone());
        }
    }
    Ok(missing)
}

fn publish(
    directory: &Path,
    identity: &Identity,
    package: &Package,
    name: String,
    description: String,
) -> Result<()> {
    require_worktree(directory)?;
    println!("Pushing resource branch and LFS objects");
    // Upload LFS objects before the branch or tag can expose pointers to unavailable content.
    git(directory, &["lfs", "push", "origin", "resource"])?;
    git(directory, &["push", "origin", "resource"])?;
    prepare_tag(directory, identity, package)?;
    println!("Preparing release {}", package.tag);
    let mut release = if let Some(release) = find_release(&package.tag)? {
        release
    } else {
        let notes = TemporaryFile::new("notes")?;
        fs::write(
            &notes.path,
            format!(
                "{name}\n\n{description}\n\nImmutable resource {} version {}.\n",
                identity.id, identity.version
            ),
        )?;
        let notes_path = notes.path.to_str().context("notes path must be UTF-8")?;
        gh_run(&[
            "release",
            "create",
            &package.tag,
            "--repo",
            REPOSITORY,
            "--verify-tag",
            "--title",
            &package.tag,
            "--draft",
            "--latest=false",
            "--notes-file",
            notes_path,
        ])?;
        find_release(&package.tag)?
            .context("created release is not visible in authenticated release list")?
    };
    ensure!(
        release["name"].as_str() == Some(&package.tag),
        "existing resource release has a different title"
    );
    for missing in verify_assets(&release, package)? {
        let path = package.directory.join(&missing);
        println!("Uploading {missing}");
        gh_run(&[
            "release",
            "upload",
            &package.tag,
            path.to_str().context("asset path must be UTF-8")?,
            "--repo",
            REPOSITORY,
        ])?;
    }
    let release_id = release["id"].as_u64().context("missing release id")?;
    release = gh(&["api", &format!("repos/{REPOSITORY}/releases/{release_id}")])?;
    ensure!(
        verify_assets(&release, package)?.is_empty(),
        "release is missing resource assets"
    );
    if release["draft"].as_bool() == Some(true) {
        gh_run(&[
            "release",
            "edit",
            &package.tag,
            "--repo",
            REPOSITORY,
            "--draft=false",
            "--latest=false",
        ])?;
    }
    println!("Verifying public asset URLs");
    verify_public_urls(&package.assets)?;
    verify_public_urls(&package.external_files)?;
    println!("Updating resource catalog");
    update_catalog(directory, identity, package, name, description)?;
    println!("Published {}; resource/catalog.json updated", package.tag);
    Ok(())
}

fn verify_public_urls(files: &[ResourceFile]) -> Result<()> {
    let client = Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(120))
        .build()?;
    for file in files {
        let response = client
            .head(&file.url)
            .send()?
            .error_for_status()
            .with_context(|| format!("public resource URL {}", file.url))?;
        let length = response
            .headers()
            .get(CONTENT_LENGTH)
            .context("public resource response has no Content-Length")?
            .to_str()?
            .parse::<u64>()?;
        ensure!(
            length == file.bytes,
            "public resource length differs: {}",
            file.path
        );
    }
    Ok(())
}

fn update_catalog(
    directory: &Path,
    identity: &Identity,
    package: &Package,
    name: String,
    description: String,
) -> Result<()> {
    require_worktree(directory)?;
    let path = directory.join("catalog.json");
    let mut catalog = if path.exists() {
        let catalog: Catalog = serde_json::from_slice(&fs::read(&path)?)?;
        catalog.validate()?;
        catalog
    } else {
        Catalog {
            schema_version: SCHEMA_VERSION,
            resources: Vec::new(),
        }
    };
    let resource = CatalogResource {
        id: identity.id.clone(),
        name,
        description,
        version: identity.version.clone(),
        manifest: package.manifest.clone(),
    };
    let mut resources: BTreeMap<_, _> = catalog
        .resources
        .into_iter()
        .map(|resource| (resource.id.clone(), resource))
        .collect();
    resources.insert(identity.id.clone(), resource);
    catalog.resources = resources.into_values().collect();
    catalog.validate()?;
    let mut bytes = serde_json::to_vec_pretty(&catalog)?;
    bytes.push(b'\n');
    if !path.exists() || fs::read(&path)? != bytes {
        fs::write(&path, bytes)?;
    }
    if !git(directory, &["status", "--porcelain", "--", "catalog.json"])?.is_empty() {
        git(directory, &["add", "--", "catalog.json"])?;
        git(
            directory,
            &[
                "commit",
                "-m",
                &format!(
                    "chore(resources): publish {} {}",
                    identity.id, identity.version
                ),
            ],
        )?;
    }
    // Always push so a previous successful local commit with a failed push is resumable.
    git(directory, &["push", "origin", "resource"])?;
    Ok(())
}

/// Temporary CLI files preserve exact notes and allow streaming large assets without buffering.
struct TemporaryFile {
    path: PathBuf,
}

impl TemporaryFile {
    fn new(kind: &str) -> Result<Self> {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nib-resource-{kind}-{}-{nonce}",
            std::process::id()
        ));
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?
            .flush()?;
        Ok(Self { path })
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_file(&self.path) {
            eprintln!(
                "Could not remove temporary file {}: {error}",
                self.path.display()
            );
        }
    }
}

#[cfg(test)]
mod tests;

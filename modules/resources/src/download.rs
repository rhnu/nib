//! Content-addressed cache transfer with strong-ETag range continuation.

use std::{
    fs::{self, OpenOptions},
    io::{Read as _, Write as _},
};

use anyhow::{Context as _, Result, ensure};
use nib_app::downloads::DownloadState;
use reqwest::{blocking::Client, header};

use crate::{
    ResourceStore,
    format::{ResourceFile, file_hash},
};

impl ResourceStore {
    pub(super) fn download(
        &self,
        client: &Client,
        file: &ResourceFile,
        task: Option<&str>,
        completed: u64,
        total: u64,
    ) -> Result<()> {
        let _cache = self
            .cache
            .lock()
            .map_err(|_poisoned| anyhow::anyhow!("resource cache lock poisoned"))?;
        let objects = self.directory.join("objects");
        // A refresh and installation may request the same manifest; serialize cache publication.
        let destination = objects.join(&file.sha256);
        if destination.exists()
            && destination.metadata()?.len() == file.bytes
            && file_hash(&destination)? == file.sha256
        {
            return Ok(());
        }
        let partial = objects.join(format!("{}.part", file.sha256));
        let etag_path = objects.join(format!("{}.etag", file.sha256));
        let offset = match partial.metadata() {
            Ok(metadata) => metadata.len(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
            Err(error) => return Err(error.into()),
        };
        let etag = match fs::read_to_string(&etag_path) {
            Ok(value) => Some(value),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        let resume = offset > 0
            && offset < file.bytes
            && etag
                .as_ref()
                .is_some_and(|value| value.starts_with('"') && value.ends_with('"'));
        let mut request = client.get(&file.url);
        if resume {
            request = request
                .header(header::RANGE, format!("bytes={offset}-"))
                .header(
                    header::IF_RANGE,
                    etag.as_deref().context("resume ETag missing")?,
                );
        }
        let mut response = request.send()?.error_for_status()?;
        let append = resume && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        if append {
            let expected = format!("bytes {offset}-");
            ensure!(
                response
                    .headers()
                    .get(header::CONTENT_RANGE)
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|value| value.starts_with(&expected)
                        && value.ends_with(&format!("/{}", file.bytes))),
                "invalid partial resource response"
            );
        } else {
            ensure!(
                response.status() == reqwest::StatusCode::OK,
                "unexpected resource download response"
            );
        }
        if let Some(etag) = response.headers().get(header::ETAG) {
            fs::write(&etag_path, etag.as_bytes())?;
        } else if etag_path.exists() {
            fs::remove_file(&etag_path)?;
        }
        let mut output = OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(&partial)?;
        let mut received = if append { offset } else { 0 };
        let mut buffer = vec![0_u8; 64 * 1024];
        loop {
            if let Some(id) = task {
                self.check_cancelled(id)?;
            }
            let count = response.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            received = received
                .checked_add(count as u64)
                .context("download length overflow")?;
            ensure!(
                received <= file.bytes,
                "download exceeds declared resource length"
            );
            output.write_all(&buffer[..count])?;
            if let Some(id) = task {
                self.update(id, DownloadState::Downloading, completed + received, total)?;
            }
        }
        output.sync_all()?;
        drop(output);
        if received != file.bytes || file_hash(&partial)? != file.sha256 {
            fs::remove_file(&partial)?;
            anyhow::bail!("resource integrity mismatch for {}", file.path);
        }
        fs::rename(partial, destination)?;
        Ok(())
    }
}

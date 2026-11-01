//! Bounded anonymous image downloads shared by dropped URLs and online exploration.
use std::{io::Cursor, time::Duration};

use reqwest::{Response, Url, header};

use super::MediaContent;

#[derive(Debug, thiserror::Error)]
pub enum RemoteImageError {
    #[error("Choose an HTTP or HTTPS image URL without embedded credentials")]
    InvalidUrl,
    #[error("The remote image request failed")]
    Request(#[from] reqwest::Error),
    #[error("Unsupported, invalid or oversized remote image")]
    Rejected,
    #[error("The remote image could not be decoded")]
    Image(#[source] image::ImageError),
    #[error("The remote image header could not be read")]
    Header(#[from] std::io::Error),
}

fn allowed_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
}

/// Retrieves only the explicitly dropped URL, without application credentials or browser cookies.
/// # Errors
/// Rejects unsupported URLs, failed requests, oversized responses and malformed images.
pub async fn download_image(url: &str) -> Result<MediaContent, RemoteImageError> {
    let url = Url::parse(url).map_err(|_error| RemoteImageError::InvalidUrl)?;
    if !allowed_url(&url) {
        return Err(RemoteImageError::InvalidUrl);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !allowed_url(attempt.url()) {
                attempt.error("Unsupported image redirect")
            } else {
                attempt.follow()
            }
        }))
        .user_agent(concat!("nib/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let response = client.get(url).send().await?.error_for_status()?;
    read_image_response(response).await
}

pub(crate) async fn read_image_response(
    mut response: Response,
) -> Result<MediaContent, RemoteImageError> {
    let mime = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_owned();
    if !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/webp") {
        return Err(RemoteImageError::Rejected);
    }
    let budget = 32 * 1024 * 1024;
    if response
        .content_length()
        .is_some_and(|length| length > budget as u64)
    {
        return Err(RemoteImageError::Rejected);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len().saturating_add(chunk.len()) > budget {
            return Err(RemoteImageError::Rejected);
        }
        bytes.extend_from_slice(&chunk);
    }
    validate_image(&bytes, &mime)?;
    tracing::debug!(byte_length = bytes.len(), mime, "read remote image");
    Ok(MediaContent {
        mime_type: mime,
        bytes,
    })
}

fn validate_image(bytes: &[u8], mime: &str) -> Result<(), RemoteImageError> {
    let reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    if reader.format().map(|format| format.to_mime_type()) != Some(mime) {
        return Err(RemoteImageError::Rejected);
    }
    let (width, height) = reader.into_dimensions().map_err(RemoteImageError::Image)?;
    if width == 0
        || height == 0
        || width > 16_384
        || height > 16_384
        || u64::from(width) * u64::from(height) > 40_000_000
    {
        return Err(RemoteImageError::Rejected);
    }
    // Decode only after header geometry and encoded bytes have passed finite budgets.
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(160 * 1024 * 1024);
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    reader.limits(limits);
    reader.decode().map_err(RemoteImageError::Image)?;
    Ok(())
}

#[cfg(test)]
mod tests;

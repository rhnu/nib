use std::{
    io::Cursor,
    time::{Duration, Instant},
};

use reqwest::{Response, header};
use serde_json::Value;

use super::{
    ExploreError, ExploreErrorKind, ExploreService, ExploreSource, connection_error, unavailable,
};
use crate::{media::MediaContent, settings::DanbooruAccess};

impl ExploreService {
    pub(super) async fn send(
        &self,
        source: ExploreSource,
        request: reqwest::RequestBuilder,
        access: Option<&DanbooruAccess>,
    ) -> Result<Response, ExploreError> {
        let index = usize::from(source == ExploreSource::NovelAi);
        {
            let mut gate = self.gates[index].lock().await;
            if let Some(until) = self.cooldowns.lock().map_err(|_error| unavailable())?[index]
                && let Some(wait) = until.checked_duration_since(Instant::now())
            {
                let mut error = ExploreError::new(
                    ExploreErrorKind::RateLimited,
                    "Source requests are cooling down",
                );
                error.retry_after_seconds = Some(
                    u32::try_from(wait.as_secs())
                        .unwrap_or(u32::MAX)
                        .saturating_add(1),
                );
                return Err(error);
            }
            if let Some(wait) = gate.checked_duration_since(Instant::now()) {
                tokio::time::sleep(wait).await;
            }
            *gate = Instant::now() + Duration::from_secs(1);
        }
        let request =
            if let Some(credentials) = access.and_then(|access| access.credentials.as_ref()) {
                credentials.authorize(request)
            } else {
                request
            };
        let response = request.send().await.map_err(|error| {
            tracing::debug!(?source, ?error, "Explore request failed");
            ExploreError::new(
                ExploreErrorKind::Unavailable,
                "The source request failed or timed out",
            )
            .with_source(error)
        })?;
        let status = response.status();
        tracing::debug!(?source, status = status.as_u16(), "Explore HTTP response");
        if status.is_success() {
            return Ok(response);
        }
        let kind = match status.as_u16() {
            401 => ExploreErrorKind::Unauthorized,
            403 => ExploreErrorKind::Forbidden,
            404 => ExploreErrorKind::NotFound,
            429 => ExploreErrorKind::RateLimited,
            500..=599 => ExploreErrorKind::Unavailable,
            _ => ExploreErrorKind::InvalidResponse,
        };
        if status.as_u16() == 401
            && source == ExploreSource::Danbooru
            && let Some(access) = access
            && access.credentials.is_some()
        {
            self.connection
                .mark_invalid(access.revision)
                .map_err(connection_error)?;
        }
        let mut error = ExploreError::new(
            kind,
            format!("The source returned HTTP {}", status.as_u16()),
        );
        if status.as_u16() == 429 {
            let seconds = response
                .headers()
                .get(header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(5)
                .clamp(1, 3600);
            error.retry_after_seconds = Some(seconds);
            self.cooldowns.lock().map_err(|_error| unavailable())?[index] =
                Some(Instant::now() + Duration::from_secs(u64::from(seconds)));
        }
        Err(error)
    }

    pub(super) async fn json(
        &self,
        source: ExploreSource,
        url: &str,
        body: Option<Value>,
        access: Option<&DanbooruAccess>,
    ) -> Result<Value, ExploreError> {
        let request = body.map_or_else(|| self.api.get(url), |body| self.api.post(url).json(&body));
        let response = self.send(source, request, access).await?;
        let mime = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("");
        if mime != "application/json" {
            return Err(ExploreError::new(
                ExploreErrorKind::InvalidResponse,
                "Source response is not JSON",
            ));
        }
        let bytes = bounded_bytes(response, 8 * 1024 * 1024).await?;
        serde_json::from_slice(&bytes).map_err(|error| {
            ExploreError::new(
                ExploreErrorKind::InvalidResponse,
                "Source returned malformed JSON",
            )
            .with_source(error)
        })
    }
}

async fn bounded_bytes(mut response: Response, budget: usize) -> Result<Vec<u8>, ExploreError> {
    if response
        .content_length()
        .is_some_and(|length| length > budget as u64)
    {
        return Err(rejected());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        ExploreError::new(
            ExploreErrorKind::Unavailable,
            "Source response was interrupted",
        )
        .with_source(error)
    })? {
        if bytes.len().saturating_add(chunk.len()) > budget {
            return Err(rejected());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub(super) async fn image_content(response: Response) -> Result<MediaContent, ExploreError> {
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
        return Err(rejected());
    }
    let bytes = bounded_bytes(response, 32 * 1024 * 1024).await?;
    validate_image(&bytes, &mime)?;
    Ok(MediaContent {
        mime_type: mime,
        bytes,
    })
}

fn validate_image(bytes: &[u8], mime: &str) -> Result<(), ExploreError> {
    let reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| rejected().with_source(error))?;
    if reader.format().map(|format| format.to_mime_type()) != Some(mime) {
        return Err(rejected());
    }
    let (width, height) = reader
        .into_dimensions()
        .map_err(|error| rejected().with_source(error))?;
    if width == 0
        || height == 0
        || width > 16_384
        || height > 16_384
        || u64::from(width) * u64::from(height) > 40_000_000
    {
        return Err(rejected());
    }
    // Decode only after header geometry and encoded bytes have passed finite budgets.
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| rejected().with_source(error))?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(160 * 1024 * 1024);
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|error| rejected().with_source(error))?;
    Ok(())
}

fn rejected() -> ExploreError {
    ExploreError::new(
        ExploreErrorKind::MediaRejected,
        "Unsupported, invalid or oversized source media",
    )
}

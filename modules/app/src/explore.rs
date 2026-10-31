//! Read-only online discovery with source-bound identities and explicit media import.
mod metadata;
mod network;
mod sources;
mod types;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
pub use types::*;

use crate::{
    media::{AssetSource, MediaAsset, MediaContent, MediaLibrary, MetadataRestore},
    session::Draft,
    settings::{DanbooruAccess, DanbooruConnection},
};

const PAGE_SIZE: u32 = 40;
const CACHE_TTL: Duration = Duration::from_secs(120);
const CACHE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
struct Cursor {
    query: ExploreQuery,
    revision: u32,
    before: Option<String>,
    offset: u32,
}

struct CachedDetail {
    value: Value,
    detail: ExploreDetail,
    at: Instant,
    complete: bool,
    byte_cost: usize,
}

/// Owns anonymous `NovelAI` access and an optional, revisioned Danbooru connection.
pub struct ExploreService {
    connection: Arc<DanbooruConnection>,
    api: reqwest::Client,
    media: reqwest::Client,
    gates: [tokio::sync::Mutex<Instant>; 2],
    cooldowns: Mutex<[Option<Instant>; 2]>,
    slots: tokio::sync::Semaphore,
    details: Mutex<HashMap<String, CachedDetail>>,
}

impl ExploreService {
    /// # Errors
    /// Returns an error if bounded HTTP clients cannot be constructed.
    pub fn new(connection: Arc<DanbooruConnection>) -> Result<Self, ExploreError> {
        let client = || {
            reqwest::Client::builder()
                .timeout(Duration::from_secs(25))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!(
                    "nib/",
                    env!("CARGO_PKG_VERSION"),
                    " (read-only image explorer)"
                ))
                .build()
                .map_err(|error| {
                    ExploreError::new(
                        ExploreErrorKind::Unavailable,
                        "Cannot initialize Explore HTTP client",
                    )
                    .with_source(error)
                })
        };
        Ok(Self {
            connection,
            api: client()?,
            media: client()?,
            gates: std::array::from_fn(|_| tokio::sync::Mutex::new(Instant::now())),
            cooldowns: Mutex::new([None, None]),
            slots: tokio::sync::Semaphore::new(4),
            details: Mutex::new(HashMap::new()),
        })
    }

    /// # Errors
    /// Rejects invalid filters, old pagination and source/network failures.
    pub async fn search(
        &self,
        query: ExploreQuery,
        cursor: Option<String>,
    ) -> Result<ExplorePage, ExploreError> {
        validate_query(&query)?;
        let source = query.source();
        let access = self.access(source)?;
        let revision = access.as_ref().map_or(0, |access| access.revision);
        let cursor = decode_cursor(cursor.as_deref(), &query, revision)?;
        let page = match source {
            ExploreSource::Danbooru => {
                self.danbooru_search(&query, &cursor, access.as_ref())
                    .await?
            },
            ExploreSource::NovelAi => self.novelai_search(&query, &cursor).await?,
        };
        self.check_revision(source, revision)?;
        tracing::debug!(
            ?source,
            count = page.items.len(),
            more = page.next_cursor.is_some(),
            "Explore search completed"
        );
        Ok(page)
    }

    /// # Errors
    /// Rejects old identities and inaccessible or malformed source posts.
    pub async fn detail(&self, key: &ExploreItemKey) -> Result<ExploreDetail, ExploreError> {
        Ok(self.raw_detail(key, true).await?.1)
    }

    async fn raw_detail(
        &self,
        key: &ExploreItemKey,
        complete: bool,
    ) -> Result<(Value, ExploreDetail), ExploreError> {
        validate_key(key)?;
        self.check_revision(key.source, key.auth_revision)?;
        let cache_key = format!("{:?}:{}:{}", key.source, key.auth_revision, key.id);
        if let Some(cached) = self
            .details
            .lock()
            .map_err(|_error| unavailable())?
            .get(&cache_key)
            .filter(|cached| (!complete || cached.complete) && cached.at.elapsed() < CACHE_TTL)
            .map(|cached| (cached.value.clone(), cached.detail.clone()))
        {
            return Ok(cached);
        }
        let access = self.access(key.source)?;
        let value = match key.source {
            ExploreSource::Danbooru => {
                self.json(
                    key.source,
                    &format!("https://danbooru.donmai.us/posts/{}.json", key.id),
                    None,
                    access.as_ref(),
                )
                .await?
            },
            ExploreSource::NovelAi => {
                self.json(
                    key.source,
                    &format!("https://explore.novelai.net/post/{}", key.id),
                    None,
                    None,
                )
                .await?
            },
        };
        let detail = sources::decode_detail(key.source, &value, key.auth_revision)?;
        if detail.summary.key.id != key.id {
            return Err(ExploreError::new(
                ExploreErrorKind::InvalidResponse,
                "Source returned another post",
            ));
        }
        self.check_revision(key.source, key.auth_revision)?;
        self.cache_detail(value.clone(), detail.clone(), true)?;
        Ok((value, detail))
    }

    fn cache_detail(
        &self,
        value: Value,
        detail: ExploreDetail,
        complete: bool,
    ) -> Result<(), ExploreError> {
        let key = &detail.summary.key;
        let cache_key = format!("{:?}:{}:{}", key.source, key.auth_revision, key.id);
        let mut cache = self.details.lock().map_err(|_error| unavailable())?;
        cache.retain(|_, entry| entry.at.elapsed() < CACHE_TTL);
        if !complete && cache.get(&cache_key).is_some_and(|entry| entry.complete) {
            return Ok(());
        }
        let byte_cost = value.to_string().len().saturating_add(
            serde_json::to_vec(&detail)
                .map_err(|error| unavailable().with_source(error))?
                .len(),
        );
        if byte_cost > CACHE_BYTES {
            return Ok(());
        }
        cache.remove(&cache_key);
        while cache.len() >= 256
            || cache.values().map(|entry| entry.byte_cost).sum::<usize>() + byte_cost > CACHE_BYTES
        {
            if let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, entry)| entry.at)
                .map(|(key, _)| key.clone())
            {
                cache.remove(&oldest);
            }
        }
        cache.insert(
            cache_key,
            CachedDetail {
                value,
                detail,
                at: Instant::now(),
                complete,
                byte_cost,
            },
        );
        Ok(())
    }

    /// Reads validated media without creating permanent local media assets.
    /// # Errors
    /// Returns stale identities, unavailable posts and media budget/format failures.
    pub async fn media(
        &self,
        key: &ExploreItemKey,
        variant: ExploreMediaVariant,
    ) -> Result<MediaContent, ExploreError> {
        let _slot = self
            .slots
            .acquire()
            .await
            .map_err(|error| unavailable().with_source(error))?;
        let (raw, _) = self.raw_detail(key, false).await?;
        let url = match key.source {
            ExploreSource::NovelAi => format!(
                "https://explore.novelai.net/post/{}/{}",
                if variant == ExploreMediaVariant::Thumbnail {
                    "thumbnail"
                } else {
                    "blob"
                },
                key.id
            ),
            ExploreSource::Danbooru => sources::danbooru_media_url(&raw, variant)?,
        };
        let response = self.send(key.source, self.media.get(url), None).await?;
        let content = network::image_content(response).await?;
        self.check_revision(key.source, key.auth_revision)?;
        Ok(content)
    }

    /// The application media library retains an imported image with remote provenance.
    /// # Errors
    /// Returns stale identities or durable media storage failures.
    pub fn import(
        &self,
        library: &MediaLibrary,
        key: &ExploreItemKey,
        content: MediaContent,
    ) -> Result<MediaAsset, ExploreError> {
        validate_key(key)?;
        self.check_revision(key.source, key.auth_revision)?;
        let persist = || {
            library
                .import_image(
                    content.bytes,
                    AssetSource::Explore {
                        source: key.source,
                        item_id: key.id.clone(),
                        website_url: sources::website_url(key.source, &key.id),
                    },
                )
                .map_err(|error| {
                    tracing::error!(?error, "Cannot retain an Explore image");
                    ExploreError::new(
                        ExploreErrorKind::Unavailable,
                        "Cannot retain imported image",
                    )
                    .with_source(error)
                })
        };
        let asset = if key.source == ExploreSource::Danbooru {
            self.connection
                .with_current_revision(key.auth_revision, persist)
                .map_err(connection_error)??
        } else {
            persist()?
        };
        tracing::info!(source=?key.source,post_id=%key.id,asset_id=%asset.id,"Explore image imported");
        Ok(asset)
    }

    /// Returns an explicit preview; applying and saving it remains a separate user action.
    /// # Errors
    /// Rejects non-`NovelAI` posts and metadata without a recognized generation model.
    pub async fn restore_metadata(
        &self,
        key: &ExploreItemKey,
        current: Draft,
    ) -> Result<MetadataRestore, ExploreError> {
        if key.source != ExploreSource::NovelAi {
            return Err(ExploreError::new(
                ExploreErrorKind::InvalidQuery,
                "This source does not provide NovelAI generation metadata",
            ));
        }
        let (value, _) = self.raw_detail(key, true).await?;
        metadata::restore(value.pointer("/image/nai_metadata"), current)
    }

    fn access(&self, source: ExploreSource) -> Result<Option<DanbooruAccess>, ExploreError> {
        if source == ExploreSource::NovelAi {
            return Ok(None);
        }
        self.connection.access().map(Some).map_err(connection_error)
    }

    fn check_revision(&self, source: ExploreSource, revision: u32) -> Result<(), ExploreError> {
        let current = if source == ExploreSource::NovelAi {
            revision == 0
        } else {
            self.connection
                .is_current(revision)
                .map_err(connection_error)?
        };
        if current {
            Ok(())
        } else {
            Err(ExploreError::new(
                ExploreErrorKind::StaleIdentity,
                "The source connection changed; search again",
            ))
        }
    }
}

impl ExploreQuery {
    fn source(&self) -> ExploreSource {
        match self {
            Self::Danbooru { .. } => ExploreSource::Danbooru,
            Self::NovelAi { .. } => ExploreSource::NovelAi,
        }
    }
}

fn connection_error(error: crate::settings::DanbooruConnectionError) -> ExploreError {
    use crate::settings::DanbooruConnectionError as E;
    let kind = match error {
        E::InvalidConnection | E::Rejected => ExploreErrorKind::Unauthorized,
        E::Conflict => ExploreErrorKind::StaleIdentity,
        _ => ExploreErrorKind::Unavailable,
    };
    ExploreError::new(
        kind,
        "The Danbooru connection is unavailable; reconnect in settings",
    )
    .with_source(error)
}

fn unavailable() -> ExploreError {
    ExploreError::new(
        ExploreErrorKind::Unavailable,
        "Explore state is unavailable",
    )
}

fn invalid(message: &str) -> ExploreError {
    ExploreError::new(ExploreErrorKind::InvalidQuery, message)
}

fn validate_key(key: &ExploreItemKey) -> Result<(), ExploreError> {
    let valid = match key.source {
        ExploreSource::Danbooru => key
            .id
            .parse::<u64>()
            .is_ok_and(|id| id > 0 && id.to_string() == key.id),
        ExploreSource::NovelAi => {
            uuid::Uuid::parse_str(&key.id).is_ok_and(|id| id.to_string() == key.id)
        },
    };
    if valid {
        Ok(())
    } else {
        Err(invalid("Invalid source post identifier"))
    }
}

fn validate_query(query: &ExploreQuery) -> Result<(), ExploreError> {
    match query {
        ExploreQuery::Danbooru { tags, ratings } => {
            if ratings.is_empty() {
                return Err(invalid("Select at least one rating"));
            }
            if tags.len() > 2048 || ratings.len() > 4 {
                return Err(invalid("Too many search filters"));
            }
            for token in tags.split_whitespace() {
                let token = token.trim_start_matches(['-', '~']).to_ascii_lowercase();
                if ["order:", "limit:", "page:", "rating:", "is:nsfw", "is:sfw"]
                    .iter()
                    .any(|prefix| token.starts_with(prefix))
                {
                    return Err(invalid(
                        "Use the rating controls; Explore always shows latest posts",
                    ));
                }
            }
        },
        ExploreQuery::NovelAi {
            sort,
            tags,
            creator_id,
            random_seed,
            ..
        } => {
            if tags.len() > 32
                || tags
                    .iter()
                    .any(|tag| tag.trim().is_empty() || tag.len() > 256)
                || creator_id.as_ref().is_some_and(|id| id.len() > 128)
            {
                return Err(invalid("Invalid Explore filters"));
            }
            if *sort == NovelAiSort::Random {
                if !tags.is_empty()
                    || creator_id.is_some()
                    || random_seed
                        .as_ref()
                        .is_none_or(|salt| salt.is_empty() || salt.len() > 128)
                {
                    return Err(invalid(
                        "Random requires a seed and cannot be combined with tags or creator filters",
                    ));
                }
            } else if random_seed.is_some() {
                return Err(invalid("Random seed only applies to random sorting"));
            }
        },
    }
    Ok(())
}

fn decode_cursor(
    cursor: Option<&str>,
    query: &ExploreQuery,
    revision: u32,
) -> Result<Cursor, ExploreError> {
    let Some(cursor) = cursor else {
        return Ok(Cursor {
            query: query.clone(),
            revision,
            before: None,
            offset: 0,
        });
    };
    if cursor.len() > 64 * 1024 {
        return Err(invalid("Invalid pagination cursor"));
    }
    let cursor: Cursor = serde_json::from_str(cursor)
        .map_err(|error| invalid("Invalid pagination cursor").with_source(error))?;
    if cursor.query != *query || cursor.revision != revision {
        return Err(ExploreError::new(
            ExploreErrorKind::StaleIdentity,
            "Pagination belongs to another query or connection",
        ));
    }
    if cursor.offset > 1_000_000 {
        return Err(invalid("Pagination limit exceeded"));
    }
    match query.source() {
        ExploreSource::Danbooru => {
            if cursor.offset != 0
                || cursor.before.as_ref().is_none_or(|id| {
                    id.parse::<u64>()
                        .map_or(true, |parsed| parsed == 0 || parsed.to_string() != *id)
                })
            {
                return Err(invalid("Invalid Danbooru pagination"));
            }
        },
        ExploreSource::NovelAi => {
            if cursor.before.is_some() {
                return Err(invalid("Invalid NovelAI pagination"));
            }
        },
    }
    Ok(cursor)
}

#[cfg(test)]
mod tests;

use serde_json::{Value, json};

use super::{
    Cursor, DanbooruAccess, ExploreDetail, ExploreDetails, ExploreError, ExploreErrorKind,
    ExploreItemKey, ExploreMediaVariant, ExplorePage, ExploreQuery, ExploreRating, ExploreService,
    ExploreSource, ExploreSummary, ExploreTagGroup, NovelAiPeriod, NovelAiSort, PAGE_SIZE, invalid,
    metadata, unavailable, validate_key,
};

pub(super) fn website_url(source: ExploreSource, id: &str) -> String {
    match source {
        ExploreSource::Danbooru => format!("https://danbooru.donmai.us/posts/{id}"),
        ExploreSource::NovelAi => format!("https://novelai.net/explore/image/{id}"),
    }
}

impl ExploreService {
    pub(super) async fn danbooru_search(
        &self,
        query: &ExploreQuery,
        cursor: &Cursor,
        access: Option<&DanbooruAccess>,
    ) -> Result<ExplorePage, ExploreError> {
        let ExploreQuery::Danbooru { tags, ratings } = query else {
            return Err(invalid("Invalid Danbooru query"));
        };
        let mut filters = tags.trim().to_owned();
        if !ratings.is_empty() {
            filters.push_str(" rating:");
            filters.push_str(
                &ratings
                    .iter()
                    .map(|rating| match rating {
                        ExploreRating::General => "g",
                        ExploreRating::Sensitive => "s",
                        ExploreRating::Questionable => "q",
                        ExploreRating::Explicit => "e",
                    })
                    .collect::<Vec<_>>()
                    .join(","),
            );
        }
        filters.push_str(" order:id_desc");
        let mut url = reqwest::Url::parse("https://danbooru.donmai.us/posts.json")
            .map_err(|error| unavailable().with_source(error))?;
        {
            let mut pairs = url.query_pairs_mut();
            pairs
                .append_pair("limit", &PAGE_SIZE.to_string())
                .append_pair("tags", &filters);
            if let Some(before) = &cursor.before {
                pairs.append_pair("page", &format!("b{before}"));
            }
        }
        let value = self
            .json(ExploreSource::Danbooru, url.as_str(), None, access)
            .await?;
        let rows = value.as_array().ok_or_else(changed)?;
        if rows.len() > PAGE_SIZE as usize {
            return Err(changed());
        }
        let mut items = Vec::new();
        for row in rows {
            match decode_detail(ExploreSource::Danbooru, row, cursor.revision) {
                Ok(detail) => {
                    self.cache_detail(row.clone(), detail.clone(), false)?;
                    items.push(detail.summary);
                },
                Err(error) if error.kind == ExploreErrorKind::NotFound => {},
                Err(error) => return Err(error),
            }
        }
        let before = rows
            .last()
            .and_then(|row| row.get("id"))
            .and_then(Value::as_u64)
            .map(|id| id.to_string());
        let next = if rows.len() == PAGE_SIZE as usize {
            before.map(|before| Cursor {
                query: query.clone(),
                revision: cursor.revision,
                before: Some(before),
                offset: 0,
            })
        } else {
            None
        };
        Ok(ExplorePage {
            items,
            next_cursor: encode_cursor(next)?,
            total: None,
            auth_revision: cursor.revision,
        })
    }

    pub(super) async fn novelai_search(
        &self,
        query: &ExploreQuery,
        cursor: &Cursor,
    ) -> Result<ExplorePage, ExploreError> {
        let value = self
            .json(
                ExploreSource::NovelAi,
                "https://explore.novelai.net/post/search",
                Some(novelai_body(query, cursor.offset)?),
                None,
            )
            .await?;
        let rows = value
            .get("results")
            .and_then(Value::as_array)
            .ok_or_else(changed)?;
        let pagination = value.get("pagination").ok_or_else(changed)?;
        let total = pagination
            .get("total")
            .and_then(Value::as_u64)
            .ok_or_else(changed)?;
        if rows.len() > PAGE_SIZE as usize
            || pagination.get("offset").and_then(Value::as_u64) != Some(u64::from(cursor.offset))
            || pagination.get("limit").and_then(Value::as_u64) != Some(u64::from(PAGE_SIZE))
        {
            return Err(changed());
        }
        let mut items = Vec::new();
        for row in rows {
            match decode_detail(ExploreSource::NovelAi, row, 0) {
                Ok(detail) => {
                    self.cache_detail(row.clone(), detail.clone(), false)?;
                    items.push(detail.summary);
                },
                Err(error) if error.kind == ExploreErrorKind::NotFound => {},
                Err(error) => return Err(error),
            }
        }
        let offset = cursor.offset.saturating_add(
            u32::try_from(rows.len()).map_err(|error| changed().with_source(error))?,
        );
        let next = (!rows.is_empty() && u64::from(offset) < total).then(|| Cursor {
            query: query.clone(),
            revision: 0,
            before: None,
            offset,
        });
        let visible_total = if rows.len() == items.len() {
            u32::try_from(total).ok()
        } else {
            None
        };
        Ok(ExplorePage {
            items,
            next_cursor: encode_cursor(next)?,
            total: visible_total,
            auth_revision: 0,
        })
    }
}

fn encode_cursor(cursor: Option<Cursor>) -> Result<Option<String>, ExploreError> {
    cursor
        .map(|cursor| {
            serde_json::to_string(&cursor).map_err(|error| unavailable().with_source(error))
        })
        .transpose()
}

pub(super) fn novelai_body(query: &ExploreQuery, offset: u32) -> Result<Value, ExploreError> {
    let ExploreQuery::NovelAi {
        sort,
        period,
        tags,
        creator_id,
        random_seed,
    } = query
    else {
        return Err(invalid("Invalid NovelAI query"));
    };
    let field = match sort {
        NovelAiSort::New => "created_at",
        NovelAiSort::Top => "top",
        NovelAiSort::Hot => "hot",
        NovelAiSort::Random => "random",
    };
    let period = match period {
        Some(NovelAiPeriod::Day) => "day",
        Some(NovelAiPeriod::Month) => "month",
        _ => "week",
    };
    let selectors = if *sort == NovelAiSort::Random {
        vec![
            json!({"field":"random","value":format!("{period}:{}",random_seed.as_deref().unwrap_or_default())}),
        ]
    } else {
        let mut selectors = tags
            .iter()
            .map(|tag| json!({"field":"tag","value":tag.trim()}))
            .collect::<Vec<_>>();
        selectors.push(if *sort == NovelAiSort::New {
            json!({"field":"moderation_status","value":"1"})
        } else {
            json!({"field":field,"value":period})
        });
        if let Some(id) = creator_id {
            selectors.push(json!({"field":"creator_id","value":id}));
        }
        selectors
    };
    Ok(
        json!({"orderers":[{"field":field,"sort_direction":"desc"}],"selectors":selectors,"pagination":{"limit":PAGE_SIZE,"offset":offset}}),
    )
}

pub(super) fn decode_detail(
    source: ExploreSource,
    value: &Value,
    revision: u32,
) -> Result<ExploreDetail, ExploreError> {
    match source {
        ExploreSource::Danbooru => danbooru(value, revision),
        ExploreSource::NovelAi => novelai(value),
    }
}

fn string(value: &Value, name: &str) -> Option<String> {
    value.get(name).and_then(Value::as_str).map(str::to_owned)
}

fn dimension(value: &Value, name: &str) -> Result<u32, ExploreError> {
    value
        .get(name)
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or_else(changed)
}

fn changed() -> ExploreError {
    ExploreError::new(
        ExploreErrorKind::InvalidResponse,
        "The source response has an unsupported shape",
    )
}

fn not_found() -> ExploreError {
    ExploreError::new(
        ExploreErrorKind::NotFound,
        "The post is not a public approved image",
    )
}

fn danbooru(value: &Value, revision: u32) -> Result<ExploreDetail, ExploreError> {
    if ["is_deleted", "is_banned", "is_pending"]
        .iter()
        .any(|name| value.get(name).and_then(Value::as_bool) == Some(true))
    {
        return Err(not_found());
    }
    let id = value
        .get("id")
        .and_then(Value::as_u64)
        .filter(|id| *id > 0)
        .ok_or_else(changed)?
        .to_string();
    let rating = match value.get("rating").and_then(Value::as_str) {
        Some("g") => ExploreRating::General,
        Some("s") => ExploreRating::Sensitive,
        Some("q") => ExploreRating::Questionable,
        Some("e") => ExploreRating::Explicit,
        _ => return Err(changed()),
    };
    let groups = [
        ("artist", "tag_string_artist"),
        ("copyright", "tag_string_copyright"),
        ("character", "tag_string_character"),
        ("general", "tag_string_general"),
        ("meta", "tag_string_meta"),
    ]
    .into_iter()
    .map(|(category, name)| ExploreTagGroup {
        category: category.into(),
        tags: string(value, name)
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_owned)
            .collect(),
    })
    .collect::<Vec<_>>();
    let author = groups[0].tags.first().cloned();
    let summary = ExploreSummary {
        key: ExploreItemKey {
            source: ExploreSource::Danbooru,
            id: id.clone(),
            auth_revision: revision,
        },
        title: format!("#{id}"),
        author,
        website_url: website_url(ExploreSource::Danbooru, &id),
        width: dimension(value, "image_width")?,
        height: dimension(value, "image_height")?,
        rating: Some(rating),
        created_at: string(value, "created_at").ok_or_else(changed)?,
        score: value
            .get("score")
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok()),
        prompt: None,
    };
    Ok(ExploreDetail {
        summary,
        details: ExploreDetails::Danbooru {
            tag_groups: groups,
            source_url: string(value, "source"),
            file_ext: string(value, "file_ext").ok_or_else(changed)?,
        },
    })
}

fn novelai(value: &Value) -> Result<ExploreDetail, ExploreError> {
    if value.get("deleted").and_then(Value::as_bool) != Some(false)
        || value.get("moderation_status").and_then(Value::as_u64) != Some(1)
        || value.get("type").and_then(Value::as_u64) != Some(1)
    {
        return Err(not_found());
    }
    let id = string(value, "id").ok_or_else(changed)?;
    let key = ExploreItemKey {
        source: ExploreSource::NovelAi,
        id: id.clone(),
        auth_revision: 0,
    };
    validate_key(&key).map_err(|error| changed().with_source(error))?;
    let image = value.get("image").ok_or_else(changed)?;
    let (metadata, _) = metadata::interpret(image.get("nai_metadata"));
    let summary = ExploreSummary {
        key,
        title: string(value, "title").unwrap_or_default(),
        author: value
            .pointer("/creator/name")
            .and_then(Value::as_str)
            .map(str::to_owned),
        website_url: website_url(ExploreSource::NovelAi, &id),
        width: dimension(image, "width")?,
        height: dimension(image, "height")?,
        rating: None,
        created_at: string(value, "created_at").ok_or_else(changed)?,
        score: value
            .get("like_count")
            .and_then(Value::as_i64)
            .and_then(|value| i32::try_from(value).ok()),
        prompt: metadata.prompt.clone(),
    };
    Ok(ExploreDetail {
        summary,
        details: ExploreDetails::NovelAi {
            description: string(value, "description").unwrap_or_default(),
            creator_id: string(value, "creator_id").or_else(|| {
                value
                    .pointer("/creator/id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            }),
            metadata,
        },
    })
}

pub(super) fn danbooru_media_url(
    value: &Value,
    variant: ExploreMediaVariant,
) -> Result<String, ExploreError> {
    let names: &[&str] = match variant {
        ExploreMediaVariant::Thumbnail => &["preview_file_url"],
        ExploreMediaVariant::Preview => &["large_file_url", "file_url"],
        ExploreMediaVariant::Original => &["file_url"],
    };
    let url = names
        .iter()
        .find_map(|name| string(value, name))
        .ok_or_else(|| {
            ExploreError::new(
                ExploreErrorKind::MediaRejected,
                "This post has no accessible image",
            )
        })?;
    let parsed = reqwest::Url::parse(&url).map_err(|error| changed().with_source(error))?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("cdn.donmai.us")
        || parsed.port().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return Err(ExploreError::new(
            ExploreErrorKind::MediaRejected,
            "Unsupported source media host",
        ));
    }
    Ok(url)
}

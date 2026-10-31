//! Exact names precede aliases and translations; semantic scores remain a separate signal.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use anyhow::{Context as _, Result, ensure};
use nib_contract::lexicon::{
    LexiconError, LexiconKind, LexiconMatch, LexiconMatchReason, LexiconQuery, LexiconSearchResult,
    LexiconTerm,
};
use rusqlite::{Connection, OpenFlags, params};

use crate::{
    format::{FORMAT_VERSION, ResourceManifest},
    semantic::{SemanticControl, SemanticSlot},
};

pub(crate) struct Snapshot {
    pub(crate) manifest: ResourceManifest,
    pub(crate) generation: String,
    pub(crate) count: u32,
    directory: PathBuf,
    database: Mutex<Connection>,
    semantic: bool,
    semantic_control: Arc<SemanticControl>,
    semantic_slot: Arc<SemanticSlot>,
    // Close SQLite and the model session before retiring the generation directory on Windows.
    pub(crate) lease: Option<Arc<nib_resources::ResourceGeneration>>,
}

impl Snapshot {
    pub(crate) fn open(
        directory: &Path,
        manifest: ResourceManifest,
        generation: String,
        semantic: bool,
        semantic_control: Arc<SemanticControl>,
    ) -> Result<Self> {
        manifest.validate()?;
        let connection = Connection::open_with_flags(
            directory.join(&manifest.core.path),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?;
        let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        ensure!(
            version == FORMAT_VERSION,
            "unsupported vocabulary database version {version}"
        );
        let count =
            connection.query_row("SELECT count(*) FROM terms", [], |row| row.get::<_, u32>(0))?;
        ensure!(count > 0, "vocabulary database is empty");
        ensure!(
            !semantic || (manifest.semantic.is_some() && manifest.model.is_some()),
            "semantic resource and query model are missing"
        );
        Ok(Self {
            lease: None,
            manifest,
            generation,
            count,
            directory: directory.to_owned(),
            database: Mutex::new(connection),
            semantic,
            semantic_slot: semantic_control.slot(),
            semantic_control,
        })
    }

    pub(crate) fn semantic_available(&self) -> bool { self.semantic }

    /// Installation validates the complete snapshot while the semantic switch is enabled.
    pub(crate) fn prepare_semantic(&self) -> Result<()> {
        let (_, revision) = self.semantic_control.status();
        if self.semantic
            && let Some(runtime) = self.semantic_control.runtime(&self.semantic_slot, revision)
        {
            runtime.prepare(&self.directory, &self.manifest, &self.generation)?;
        }
        Ok(())
    }

    pub(crate) fn search(
        &self,
        query: &LexiconQuery,
        revision: u32,
    ) -> Result<LexiconSearchResult> {
        let limit = query.limit as usize;
        let kinds = kind_filter(&query.kinds);
        let mut matches = {
            let connection = self
                .database
                .lock()
                .map_err(|_state| anyhow::anyhow!("vocabulary database lock poisoned"))?;
            if let Some(key) = &query.related_to {
                related(&connection, key, &kinds, limit)?
            } else {
                lexical(&connection, &normalize(query.text.trim()), &kinds, limit)?
            }
        };
        if query.semantic
            && self.semantic
            && !query.text.trim().is_empty()
            && query.related_to.is_none()
            && let Some(runtime) = self.semantic_control.runtime(&self.semantic_slot, revision)
            && let Some(semantic) =
                runtime.snapshot(&self.directory, &self.manifest, &self.generation)?
        {
            let index = &semantic.index;
            let applicable = query.kinds.is_empty()
                || semantic
                    .indexed_kinds
                    .iter()
                    .any(|kind| query.kinds.contains(kind));
            let vector = if applicable {
                runtime.encoder.encode(
                    &self.directory,
                    &self.generation,
                    self.manifest
                        .model
                        .as_ref()
                        .context("query model missing")?,
                    query.text.trim(),
                    || runtime.active(),
                )?
            } else {
                None
            };
            if let Some(vector) = vector
                && runtime.active()
            {
                let scores = index.search(&vector, limit, |key| {
                    query.kinds.is_empty()
                        || semantic
                            .kinds
                            .get(key)
                            .is_some_and(|kind| query.kinds.contains(kind))
                });
                let connection = self
                    .database
                    .lock()
                    .map_err(|_state| anyhow::anyhow!("vocabulary database lock poisoned"))?;
                let mut statement =
                    connection.prepare(&format!("SELECT {COLUMNS} FROM terms t WHERE t.key=?1"))?;
                for (row, score) in scores {
                    let term = statement.query_row([&index.keys[row]], read_term)?;
                    matches.push(LexiconMatch {
                        term,
                        reason: LexiconMatchReason::Semantic,
                        score,
                    });
                }
            }
        }
        rank(&mut matches, limit);
        Ok(LexiconSearchResult {
            generation: Some(self.generation.clone()),
            revision,
            matches,
            semantic_available: self.semantic_available() && self.semantic_control.status().0,
        })
    }
}

/// Validate before accessing an optional snapshot so invalid queries fail even when uninstalled.
pub(crate) fn validate_query(query: &LexiconQuery) -> Result<(), LexiconError> {
    if !(1..=100).contains(&query.limit) {
        return Err(LexiconError::Invalid(
            "vocabulary result limit must be 1–100".into(),
        ));
    }
    if query.text.len() > 2048 {
        return Err(LexiconError::Invalid("vocabulary query is too long".into()));
    }
    Ok(())
}

pub(crate) fn kind_name(kind: LexiconKind) -> &'static str {
    match kind {
        LexiconKind::General => "general",
        LexiconKind::Artist => "artist",
        LexiconKind::Copyright => "copyright",
        LexiconKind::Character => "character",
        LexiconKind::Meta => "meta",
    }
}

pub(crate) fn normalize(text: &str) -> String { text.replace('_', " ").to_lowercase() }

fn kind_filter(kinds: &[LexiconKind]) -> String {
    if kinds.is_empty() {
        return "1".into();
    }
    format!(
        "t.kind IN ({})",
        kinds
            .iter()
            .map(|kind| format!("'{}'", kind_name(*kind)))
            .collect::<Vec<_>>()
            .join(",")
    )
}

fn read_term(row: &rusqlite::Row<'_>) -> rusqlite::Result<LexiconTerm> {
    let decode = |index: usize| -> rusqlite::Result<serde_json::Value> {
        let value: String = row.get(index)?;
        serde_json::from_str(&value).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
    };
    let kind = serde_json::from_value(serde_json::Value::String(row.get(2)?)).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(LexiconTerm {
        key: row.get(0)?,
        name: row.get(1)?,
        prompt_text: row.get(9)?,
        kind,
        translation: row.get(3)?,
        description: row.get(4)?,
        post_count: row.get(5)?,
        aliases: serde_json::from_value(decode(6)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        groups: serde_json::from_value(decode(7)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        source: row.get(8)?,
    })
}

const COLUMNS: &str = "t.key,t.name,t.kind,t.translation,t.description,t.post_count,t.aliases,t.groups_json,t.source,t.prompt_text";

fn lexical(
    connection: &Connection,
    text: &str,
    kinds: &str,
    limit: usize,
) -> Result<Vec<LexiconMatch>> {
    let limit = i64::try_from(limit)?;
    let escaped = text
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let prefix = format!("{escaped}%");
    let mut statement = connection.prepare(&format!("SELECT {COLUMNS},CASE WHEN t.normalized=?1 THEN 4.0 ELSE 3.0 END FROM terms t WHERE {kinds} AND t.normalized LIKE ?2 ESCAPE '\\' ORDER BY 11 DESC,t.post_count DESC,t.key LIMIT ?3"))?;
    let mut matches = statement
        .query_map(params![text, prefix, limit], |row| {
            Ok(LexiconMatch {
                term: read_term(row)?,
                reason: LexiconMatchReason::Name,
                score: row.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if text.is_empty() {
        return Ok(matches);
    }
    let contains = if text.chars().count() < 3 {
        format!("%{escaped}%")
    } else {
        prefix
    };
    let mut statement = connection.prepare(&format!("SELECT DISTINCT {COLUMNS},l.reason,CASE WHEN l.reason='alias' AND l.text=?3 THEN 3.5 WHEN l.reason='alias' THEN 2.5 WHEN l.reason='translation' THEN 1.8 ELSE 0.6 END FROM lookup l JOIN terms t ON t.key=l.term_key WHERE {kinds} AND l.text LIKE ?1 ESCAPE '\\' ORDER BY 12 DESC,t.post_count DESC,t.key LIMIT ?2"))?;
    matches.extend(
        statement
            .query_map(params![contains, limit, text], |row| {
                Ok(LexiconMatch {
                    term: read_term(row)?,
                    reason: if row.get::<_, String>(10)? == "alias" {
                        LexiconMatchReason::Alias
                    } else {
                        LexiconMatchReason::Translation
                    },
                    score: row.get(11)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?,
    );
    if text.chars().count() >= 3 {
        let expression = format!("\"{}\"", text.replace('"', "\"\""));
        let mut statement = connection.prepare(&format!("SELECT {COLUMNS} FROM terms_fts f JOIN terms t ON t.key=f.key WHERE terms_fts MATCH ?1 AND {kinds} ORDER BY rank,t.post_count DESC,t.key LIMIT ?2"))?;
        matches.extend(
            statement
                .query_map(params![expression, limit], |row| {
                    Ok(LexiconMatch {
                        term: read_term(row)?,
                        reason: LexiconMatchReason::Translation,
                        score: 0.4,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?,
        );
    }
    Ok(matches)
}

fn related(
    connection: &Connection,
    key: &str,
    kinds: &str,
    limit: usize,
) -> Result<Vec<LexiconMatch>> {
    let limit = i64::try_from(limit)?;
    let mut statement = connection.prepare(&format!("SELECT {COLUMNS},r.score FROM relations r JOIN terms t ON t.key=r.target_key WHERE r.source_key=?1 AND {kinds} ORDER BY r.score DESC,t.post_count DESC,t.key LIMIT ?2"))?;
    Ok(statement
        .query_map(params![key, limit], |row| {
            Ok(LexiconMatch {
                term: read_term(row)?,
                reason: LexiconMatchReason::Related,
                score: row.get(10)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Deduplicate canonical identities after ranking so semantic matches never replace exact names.
fn rank(matches: &mut Vec<LexiconMatch>, limit: usize) {
    matches.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then(right.term.post_count.cmp(&left.term.post_count))
            .then(left.term.key.cmp(&right.term.key))
    });
    let mut seen = HashSet::new();
    matches.retain(|item| seen.insert(item.term.key.clone()));
    matches.truncate(limit);
}

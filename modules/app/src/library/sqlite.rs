use rusqlite::{Connection, params};

use super::{
    ResourceKind, ResourcePage, ResourceQuery, ResourceSearch, ResourceSort, ResourceSummary,
};
use crate::{
    persistence::{PersistenceError, SqliteDatabase, encode},
    prompt::{Resource, ResourceContent},
};

pub(crate) fn summary(resource: &Resource) -> ResourceSummary {
    ResourceSummary {
        id: resource.id.clone(),
        revision: resource.revision,
        name: resource.name.clone(),
        kind: match resource.content {
            ResourceContent::Chunk { .. } => ResourceKind::Chunk,
            ResourceContent::Preset { .. } => ResourceKind::Preset,
        },
        description: resource.description.clone(),
        aliases: resource.aliases.clone(),
        tags: resource.tags.clone(),
        models: resource.models.clone(),
        folder_id: resource.folder_id.clone(),
        cover_asset_id: resource.cover_asset_id.clone(),
        created_at: resource.created_at,
        updated_at: resource.updated_at,
    }
}

pub(crate) fn all_resources(connection: &Connection) -> Result<Vec<Resource>, PersistenceError> {
    let mut statement = connection
        .prepare("SELECT id FROM resources ORDER BY name COLLATE NOCASE,id")
        .map_err(|error| PersistenceError::failure("prepare resource identities", error))?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| PersistenceError::failure("read resource identities", error))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| PersistenceError::failure("decode resource identities", error))?;
    ids.iter()
        .map(|id| {
            crate::prompt::sqlite::get_resource(connection, id)?.ok_or_else(|| {
                PersistenceError::NotFound {
                    kind: "resource",
                    id: id.clone(),
                }
            })
        })
        .collect()
}

impl ResourceSearch for SqliteDatabase {
    fn search_resources(&self, query: &ResourceQuery) -> Result<ResourcePage, PersistenceError> {
        if !(1..=200).contains(&query.limit) {
            return Err(super::invalid(crate::api::UserMessage::ResourcePageLimit));
        }
        if let Some(id) = &query.folder_id {
            super::validate_id(id)?;
        }
        let mut connection = self.connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| PersistenceError::failure("begin resource search", error))?;
        let kind = query.kind.map(|kind| match kind {
            ResourceKind::Chunk => "chunk",
            ResourceKind::Preset => "preset",
        });
        // JSON is only the bounded query input; searchable metadata belongs to indexed relations.
        let filter = "WITH RECURSIVE subtree(id) AS (SELECT id FROM resource_folders WHERE id=?3 UNION ALL SELECT f.id FROM resource_folders f JOIN subtree p ON f.parent_id=p.id) SELECT r.id FROM resources r WHERE (?1 IS NULL OR r.kind=?1) AND (instr(lower(r.name),lower(?2))>0 OR EXISTS(SELECT 1 FROM resource_aliases a WHERE a.resource_id=r.id AND instr(lower(a.value),lower(?2))>0)) AND (?3 IS NULL OR r.folder_id=?3 OR (?4 AND r.folder_id IN (SELECT id FROM subtree))) AND (NOT ?5 OR r.folder_id IS NULL) AND NOT EXISTS(SELECT 1 FROM json_each(?6) wanted WHERE NOT EXISTS(SELECT 1 FROM resource_tags t WHERE t.resource_id=r.id AND t.value=wanted.value COLLATE NOCASE)) AND (json_array_length(?7)=0 OR NOT EXISTS(SELECT 1 FROM resource_models m WHERE m.resource_id=r.id) OR EXISTS(SELECT 1 FROM resource_models m JOIN json_each(?7) wanted ON m.value=wanted.value WHERE m.resource_id=r.id))";
        let tags = encode(&query.tags)?;
        let models = encode(&query.models)?;
        let total = transaction
            .query_row(
                &format!("SELECT count(*) FROM ({filter})"),
                params![
                    kind,
                    query.text.trim(),
                    query.folder_id,
                    query.include_subfolders,
                    query.root_only,
                    tags,
                    models
                ],
                |row| row.get(0),
            )
            .map_err(|error| PersistenceError::failure("count matching resources", error))?;
        let order = match query.sort {
            ResourceSort::Name => "sorted.name COLLATE NOCASE",
            ResourceSort::CreatedAt => "sorted.created_at",
            ResourceSort::UpdatedAt => "sorted.updated_at",
        };
        let direction = if query.descending { "DESC" } else { "ASC" };
        // Project list fields directly; content is decoded only when opened or resolved.
        let columns = "sorted.id,sorted.revision,sorted.name,sorted.kind,sorted.description,sorted.folder_id,sorted.cover_asset_id,sorted.created_at,sorted.updated_at,(SELECT json_group_array(value) FROM (SELECT value FROM resource_aliases WHERE resource_id=sorted.id ORDER BY value COLLATE NOCASE)),(SELECT json_group_array(value) FROM (SELECT value FROM resource_tags WHERE resource_id=sorted.id ORDER BY value COLLATE NOCASE)),(SELECT json_group_array(value) FROM (SELECT value FROM resource_models WHERE resource_id=sorted.id ORDER BY value COLLATE NOCASE))";
        let mut statement = transaction.prepare(&format!("SELECT {columns} FROM ({filter}) matched JOIN resources sorted ON sorted.id=matched.id ORDER BY {order} {direction},matched.id {direction} LIMIT ?8 OFFSET ?9"))
            .map_err(|error|PersistenceError::failure("prepare resource search",error))?;
        let items = statement
            .query_map(
                params![
                    kind,
                    query.text.trim(),
                    query.folder_id,
                    query.include_subfolders,
                    query.root_only,
                    tags,
                    models,
                    query.limit,
                    query.offset
                ],
                read_summary,
            )
            .map_err(|error| PersistenceError::failure("search resources", error))?
            .collect::<Result<_, _>>()
            .map_err(|error| PersistenceError::failure("read resource summaries", error))?;
        drop(statement);
        transaction
            .commit()
            .map_err(|error| PersistenceError::failure("finish resource search", error))?;
        Ok(ResourcePage { items, total })
    }
}

fn read_summary(row: &rusqlite::Row<'_>) -> rusqlite::Result<ResourceSummary> {
    let kind = match row.get::<_, String>(3)?.as_str() {
        "chunk" => ResourceKind::Chunk,
        "preset" => ResourceKind::Preset,
        _ => {
            return Err(rusqlite::Error::InvalidColumnType(
                3,
                "kind".into(),
                rusqlite::types::Type::Text,
            ));
        },
    };
    Ok(ResourceSummary {
        id: row.get(0)?,
        revision: row.get(1)?,
        name: row.get(2)?,
        kind,
        description: row.get(4)?,
        folder_id: row.get(5)?,
        cover_asset_id: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        aliases: read_values(row, 9)?,
        tags: read_values(row, 10)?,
        models: read_values(row, 11)?,
    })
}

fn read_values(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<Vec<String>> {
    serde_json::from_str(&row.get::<_, String>(index)?).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

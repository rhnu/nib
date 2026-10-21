use rusqlite::params;

use super::{ResourceKind, ResourceQuery, ResourceSearch, ResourceSummary};
use crate::persistence::{PersistenceError, SqliteDatabase};

impl ResourceSearch for SqliteDatabase {
    fn search_resources(
        &self,
        query: &ResourceQuery,
    ) -> Result<Vec<ResourceSummary>, PersistenceError> {
        let connection = self.connection()?;
        let kind = query.kind.map(|kind| match kind {
            ResourceKind::Chunk => "chunk",
            ResourceKind::Preset => "preset",
        });
        // instr treats '%' and '_' literally, unlike a user-supplied LIKE pattern.
        let mut statement = connection.prepare(
            "SELECT id, revision, name, kind FROM resources WHERE (?1 IS NULL OR kind = ?1) AND instr(lower(name), lower(?2)) > 0 ORDER BY name COLLATE NOCASE, id",
        ).map_err(|error| PersistenceError::failure("prepare a resource query", error))?;
        statement
            .query_map(params![kind, query.text.trim()], |row| {
                let kind: String = row.get(3)?;
                let kind = match kind.as_str() {
                    "chunk" => ResourceKind::Chunk,
                    "preset" => ResourceKind::Preset,
                    _ => {
                        return Err(rusqlite::Error::InvalidColumnType(
                            3,
                            "kind".to_owned(),
                            rusqlite::types::Type::Text,
                        ));
                    },
                };
                Ok(ResourceSummary {
                    id: row.get(0)?,
                    revision: row.get(1)?,
                    name: row.get(2)?,
                    kind,
                })
            })
            .map_err(|error| PersistenceError::failure("search resources", error))?
            .collect::<Result<_, _>>()
            .map_err(|error| PersistenceError::failure("read resource query results", error))
    }
}

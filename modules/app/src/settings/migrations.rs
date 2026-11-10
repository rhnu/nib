//! Settings schema history, retained from stable schema 1.
use crate::{
    migrations::{DatabaseMigrations, Migration},
    persistence::PersistenceError,
};
pub(crate) const MIGRATIONS: DatabaseMigrations = DatabaseMigrations {
    name: "settings",
    current: 3,
    steps: &[
        Migration {
            from: 1,
            apply: extensions,
        },
        Migration {
            from: 2,
            apply: system_prompt,
        },
    ],
};

fn extensions(transaction: &rusqlite::Transaction<'_>) -> Result<(), PersistenceError> {
    transaction.execute_batch("ALTER TABLE global_settings ADD COLUMN agent_mcp_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(agent_mcp_json)); ALTER TABLE global_settings ADD COLUMN agent_skills_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(agent_skills_json));")
        .map_err(|error| PersistenceError::failure("upgrade Agent extension settings", error))
}

fn system_prompt(transaction: &rusqlite::Transaction<'_>) -> Result<(), PersistenceError> {
    transaction.execute_batch("ALTER TABLE global_settings ADD COLUMN agent_system_prompt_json TEXT CHECK (agent_system_prompt_json IS NULL OR json_valid(agent_system_prompt_json));")
        .map_err(|error| PersistenceError::failure("upgrade Agent system prompt settings", error))
}

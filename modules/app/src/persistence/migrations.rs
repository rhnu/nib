//! Creation schema history. Add a step for each increase of the stable schema version.

use crate::migrations::DatabaseMigrations;

pub(crate) const MIGRATIONS: DatabaseMigrations = DatabaseMigrations {
    name: "creation",
    current: 1,
    steps: &[],
};

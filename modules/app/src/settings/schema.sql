CREATE TABLE global_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    preferences_json TEXT NOT NULL CHECK (json_valid(preferences_json)),
    current_directory_json TEXT CHECK (current_directory_json IS NULL OR json_valid(current_directory_json))
);

CREATE TABLE credentials (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    secret_id TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1))
);
CREATE UNIQUE INDEX one_active_credential ON credentials(active) WHERE active = 1;
CREATE TABLE credential_versions (id TEXT PRIMARY KEY, credential_id TEXT NOT NULL REFERENCES credentials(id));
PRAGMA user_version = 5;

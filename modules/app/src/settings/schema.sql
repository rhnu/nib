CREATE TABLE global_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    preferences_json TEXT NOT NULL CHECK (json_valid(preferences_json)),
    agent_connection_json TEXT CHECK (agent_connection_json IS NULL OR json_valid(agent_connection_json)),
    agent_generation_permission TEXT NOT NULL DEFAULT '"ask"' CHECK (json_valid(agent_generation_permission)),
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
CREATE TABLE danbooru_connection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT,
    secret_id TEXT,
    user_id INTEGER,
    revision INTEGER NOT NULL DEFAULT 0,
    valid INTEGER NOT NULL DEFAULT 0 CHECK (valid IN (0, 1)),
    CHECK ((username IS NULL) = (secret_id IS NULL)),
    CHECK ((username IS NULL) = (user_id IS NULL))
);
INSERT INTO danbooru_connection (id) VALUES (1);

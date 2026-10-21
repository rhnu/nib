CREATE TABLE resources (
    id TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    name TEXT NOT NULL,
    content TEXT NOT NULL CHECK (json_valid(content)),
    kind TEXT GENERATED ALWAYS AS (json_extract(content, '$.kind')) VIRTUAL
);
CREATE INDEX resources_kind_name ON resources(kind, name COLLATE NOCASE);

CREATE TABLE current_creation (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL CHECK (revision > 0),
    composition TEXT NOT NULL CHECK (json_valid(composition)),
    presets TEXT NOT NULL CHECK (json_valid(presets)),
    settings TEXT NOT NULL CHECK (json_valid(settings))
);

PRAGMA user_version = 2;

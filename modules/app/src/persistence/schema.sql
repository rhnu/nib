CREATE TABLE resources (
    id TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    name TEXT NOT NULL,
    content TEXT NOT NULL CHECK (json_valid(content)),
    kind TEXT GENERATED ALWAYS AS (json_extract(content, '$.kind')) VIRTUAL
);
CREATE INDEX resources_kind_name ON resources(kind, name COLLATE NOCASE);

CREATE TABLE drafts (
    id TEXT PRIMARY KEY NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    name TEXT NOT NULL,
    composition TEXT NOT NULL CHECK (json_valid(composition)),
    presets TEXT NOT NULL CHECK (json_valid(presets)),
    settings TEXT NOT NULL CHECK (json_valid(settings)),
    updated_at INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER))
);
CREATE INDEX drafts_recent ON drafts(updated_at DESC);

PRAGMA user_version = 1;

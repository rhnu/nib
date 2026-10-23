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
    settings TEXT NOT NULL CHECK (json_valid(settings)),
    characters TEXT NOT NULL CHECK (json_valid(characters)),
    inputs TEXT NOT NULL CHECK (json_valid(inputs)),
    mask_editor TEXT NOT NULL CHECK (json_valid(mask_editor)),
    vibe_encoder TEXT NOT NULL CHECK (json_valid(vibe_encoder))
);

CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
    submitted_at INTEGER NOT NULL,
    finished_at INTEGER,
    error TEXT,
    submission TEXT NOT NULL CHECK (json_valid(submission))
);
CREATE INDEX jobs_status_id ON jobs(status, id);

CREATE TABLE media_assets (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'vibe', 'vibeDocument')),
    mime_type TEXT NOT NULL,
    byte_length INTEGER NOT NULL CHECK (byte_length > 0),
    width INTEGER,
    height INTEGER,
    created_at INTEGER NOT NULL,
    source TEXT NOT NULL CHECK (json_valid(source))
);

CREATE TABLE generation_results (
    id TEXT PRIMARY KEY NOT NULL,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    sample_index INTEGER NOT NULL CHECK (sample_index >= 0),
    asset_id TEXT NOT NULL REFERENCES media_assets(id),
    seed INTEGER,
    image_source TEXT CHECK (image_source IS NULL OR json_valid(image_source)),
    created_at INTEGER NOT NULL,
    UNIQUE (job_id, sample_index)
);

PRAGMA user_version = 8;

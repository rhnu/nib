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

CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
    submitted_at INTEGER NOT NULL,
    finished_at INTEGER,
    error TEXT,
    submission TEXT NOT NULL CHECK (json_valid(submission))
);
CREATE INDEX jobs_status_id ON jobs(status, id);

CREATE TABLE generation_results (
    id TEXT PRIMARY KEY NOT NULL,
    job_id INTEGER NOT NULL REFERENCES jobs(id),
    sample_index INTEGER NOT NULL CHECK (sample_index >= 0),
    seed INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    format TEXT NOT NULL CHECK (json_valid(format)),
    byte_length INTEGER NOT NULL CHECK (byte_length > 0),
    UNIQUE (job_id, sample_index)
);

PRAGMA user_version = 3;

CREATE TABLE resource_folders (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES resource_folders(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX resource_folder_names ON resource_folders(COALESCE(parent_id, ''), name COLLATE NOCASE);

CREATE TABLE resources (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    folder_id TEXT REFERENCES resource_folders(id),
    cover_asset_id TEXT UNIQUE REFERENCES media_assets(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    content TEXT NOT NULL CHECK (json_valid(content)),
    kind TEXT GENERATED ALWAYS AS (json_extract(content, '$.kind')) STORED
);
CREATE INDEX resources_kind_name ON resources(kind, name COLLATE NOCASE);
CREATE INDEX resources_folder ON resources(folder_id);
CREATE TABLE resource_aliases (
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    value TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY(resource_id, value)
);
CREATE TABLE resource_tags (
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    value TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY(resource_id, value)
);
CREATE INDEX resource_tag_values ON resource_tags(value);
CREATE TABLE resource_models (
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    PRIMARY KEY(resource_id, value)
);
CREATE INDEX resource_model_values ON resource_models(value);

CREATE TABLE current_creation (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    composition TEXT NOT NULL CHECK (json_valid(composition)),
    presets TEXT NOT NULL CHECK (json_valid(presets)),
    settings TEXT NOT NULL CHECK (json_valid(settings)),
    characters TEXT NOT NULL CHECK (json_valid(characters)),
    inputs TEXT NOT NULL CHECK (json_valid(inputs)),
    mask_editor TEXT NOT NULL CHECK (json_valid(mask_editor)),
    vibe_encoder TEXT NOT NULL CHECK (json_valid(vibe_encoder)),
    director TEXT NOT NULL CHECK (json_valid(director)),
    png_text_editor TEXT NOT NULL CHECK (json_valid(png_text_editor)),
    active_page TEXT NOT NULL CHECK (json_valid(active_page)),
    prompt_editor TEXT NOT NULL CHECK (json_valid(prompt_editor))
);

CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    request_index INTEGER NOT NULL CHECK (request_index >= 0),
    request_count INTEGER NOT NULL CHECK (request_count BETWEEN 1 AND 8),
    retry_of_job_id TEXT,
    encoding_key TEXT,
    credential_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')),
    submitted_at INTEGER NOT NULL,
    finished_at INTEGER,
    error TEXT,
    submission TEXT NOT NULL CHECK (json_valid(submission)),
    execution TEXT NOT NULL CHECK (json_valid(execution)),
    observation TEXT CHECK (observation IS NULL OR json_valid(observation))
);
CREATE INDEX jobs_status_id ON jobs(status, id);
CREATE UNIQUE INDEX jobs_batch_request ON jobs(batch_id, request_index);
CREATE INDEX jobs_credential_status ON jobs(credential_id, status);
CREATE INDEX jobs_encoding_key_status ON jobs(encoding_key, status, id);

CREATE TABLE media_blobs (
    id TEXT PRIMARY KEY NOT NULL,
    byte_length INTEGER NOT NULL CHECK (byte_length > 0)
);

CREATE TABLE media_assets (
    id TEXT PRIMARY KEY NOT NULL,
    blob_id TEXT NOT NULL REFERENCES media_blobs(id),
    owner_resource_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'vibe', 'vibeDocument')),
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at INTEGER NOT NULL,
    source TEXT NOT NULL CHECK (json_valid(source))
);
CREATE INDEX media_assets_blob ON media_assets(blob_id);
CREATE INDEX media_assets_owner ON media_assets(owner_resource_id);

CREATE TABLE media_references (
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('resource', 'creation', 'job', 'asset', 'result', 'agent')),
    owner_id TEXT NOT NULL,
    asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
    PRIMARY KEY (owner_kind, owner_id, asset_id)
);
CREATE INDEX media_references_asset ON media_references(asset_id);

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

CREATE TABLE image_safety (
    blob_id TEXT PRIMARY KEY NOT NULL REFERENCES media_blobs(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (json_valid(status)),
    reason TEXT,
    assessment TEXT CHECK (assessment IS NULL OR json_valid(assessment))
);

CREATE TABLE agent_chat (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    history_json TEXT NOT NULL CHECK (json_valid(history_json)),
    resource_edits_json TEXT NOT NULL CHECK (json_valid(resource_edits_json))
);

PRAGMA user_version = 20;

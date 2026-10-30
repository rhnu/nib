PRAGMA user_version = 1;
CREATE TABLE terms (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    normalized TEXT NOT NULL,
    kind TEXT NOT NULL,
    translation TEXT,
    description TEXT,
    post_count INTEGER NOT NULL,
    aliases TEXT NOT NULL,
    groups_json TEXT NOT NULL,
    source TEXT NOT NULL,
    prompt_text TEXT NOT NULL
);
CREATE INDEX terms_name ON terms(normalized COLLATE NOCASE);
CREATE INDEX terms_kind_count ON terms(kind, post_count DESC);
CREATE TABLE lookup (term_key TEXT NOT NULL REFERENCES terms(key), text TEXT NOT NULL, reason TEXT NOT NULL);
CREATE INDEX lookup_text ON lookup(text COLLATE NOCASE);
CREATE VIRTUAL TABLE terms_fts USING fts5(key UNINDEXED, text, tokenize='trigram');
CREATE TABLE relations (source_key TEXT NOT NULL REFERENCES terms(key), target_key TEXT NOT NULL REFERENCES terms(key), kind TEXT NOT NULL, score REAL NOT NULL);
CREATE INDEX relations_source ON relations(source_key, score DESC);

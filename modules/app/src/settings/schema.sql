CREATE TABLE global_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    preferences_json TEXT NOT NULL CHECK (json_valid(preferences_json)),
    current_directory_json TEXT CHECK (current_directory_json IS NULL OR json_valid(current_directory_json)),
    pending_directory_json TEXT CHECK (pending_directory_json IS NULL OR json_valid(pending_directory_json))
);

PRAGMA user_version = 1;

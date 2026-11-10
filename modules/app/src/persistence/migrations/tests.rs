use super::*;

#[test]
fn singleton_upgrade_preserves_transcript_undo_and_media_ownership() {
    let mut connection = rusqlite::Connection::open_in_memory().unwrap();
    connection.execute_batch(
        "PRAGMA foreign_keys=ON;
         CREATE TABLE agent_chat(id INTEGER PRIMARY KEY CHECK(id=1),snapshot_json TEXT NOT NULL,history_json TEXT NOT NULL,resource_edits_json TEXT NOT NULL);
         CREATE TABLE media_references(owner_kind TEXT,owner_id TEXT,asset_id TEXT,PRIMARY KEY(owner_kind,owner_id,asset_id));",
    ).unwrap();
    let snapshot = r#"{"messages":[{"role":"user","content":" First request "}]}"#;
    let history = r#"[{"role":"user","content":"retained native history"}]"#;
    let edits = r#"[{"before":{"id":"resource"},"after":{"id":"resource"}}]"#;
    connection
        .execute(
            "INSERT INTO agent_chat VALUES(1,?1,?2,?3)",
            params![snapshot, history, edits],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO media_references VALUES('agent','1','asset')",
            [],
        )
        .unwrap();
    let transaction = connection.transaction().unwrap();
    agent_sessions(&transaction).unwrap();
    transaction.commit().unwrap();
    let (id, title, restored_snapshot, restored_history, restored_edits): (
        String,
        String,
        String,
        String,
        String,
    ) = connection
        .query_row(
            "SELECT id,title,snapshot_json,history_json,resource_edits_json FROM agent_chat",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .unwrap();
    assert!(uuid::Uuid::parse_str(&id).is_ok());
    assert_eq!(title, "First request");
    assert_eq!(
        (
            restored_snapshot.as_str(),
            restored_history.as_str(),
            restored_edits.as_str()
        ),
        (snapshot, history, edits)
    );
    let selected: String = connection
        .query_row("SELECT session_id FROM agent_selection", [], |row| {
            row.get(0)
        })
        .unwrap();
    let owner: String = connection
        .query_row(
            "SELECT owner_id FROM media_references WHERE owner_kind='agent'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(selected, id);
    assert_eq!(owner, id);
}

#[test]
fn empty_singleton_upgrade_leaves_initialization_to_the_domain() {
    let mut connection = rusqlite::Connection::open_in_memory().unwrap();
    connection.execute_batch("CREATE TABLE agent_chat(id INTEGER PRIMARY KEY,snapshot_json TEXT,history_json TEXT,resource_edits_json TEXT);
        CREATE TABLE media_references(owner_kind TEXT,owner_id TEXT,asset_id TEXT);").unwrap();
    let transaction = connection.transaction().unwrap();
    agent_sessions(&transaction).unwrap();
    transaction.commit().unwrap();
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM agent_chat", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

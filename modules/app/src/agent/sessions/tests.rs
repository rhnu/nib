use std::path::Path;

use super::*;
use crate::agent::AgentMessage;

fn database() -> SqliteDatabase { SqliteDatabase::open(Path::new(":memory:")).unwrap() }

fn add_user(database: &SqliteDatabase, text: &str) -> StoredChat {
    let mut chat = database.agent_chat().unwrap();
    chat.snapshot.messages.push(AgentMessage {
        id: uuid::Uuid::new_v4().to_string(),
        role: "user".into(),
        content: text.into(),
        tool_name: None,
        success: None,
        asset_ids: vec![],
    });
    chat.history = serde_json::json!([{"role":"user", "content":text}]);
    database.save_agent_chat(&chat).unwrap();
    chat
}

#[test]
fn blank_is_reused_and_selected_identity_is_retained() {
    let database = database();
    let first = database.agent_chat().unwrap();
    assert!(uuid::Uuid::parse_str(&first.id).is_ok());
    assert_eq!(first.snapshot.session_id, first.id);
    assert_eq!(database.new_agent_session().unwrap().id, first.id);
    assert_eq!(database.agent_sessions().unwrap().len(), 1);
    let first = add_user(&database, "  First request  ");
    let second = database.new_agent_session().unwrap();
    assert_ne!(first.id, second.id);
    let selected = database.select_agent_session(&first.id).unwrap();
    assert_eq!(selected.history, first.history);
    assert_eq!(database.agent_chat().unwrap().id, first.id);
    assert_eq!(database.agent_sessions().unwrap()[1].title, "First request");
    assert!(matches!(
        database.save_agent_chat(&second),
        Err(PersistenceError::Conflict { .. })
    ));
}

#[test]
fn selecting_another_session_atomically_persists_undo_revocation() {
    let database = database();
    let mut first = add_user(&database, "first");
    first.snapshot.resources_undo_available = true;
    database.save_agent_chat(&first).unwrap();
    assert!(
        database
            .select_agent_session(&first.id)
            .unwrap()
            .snapshot
            .resources_undo_available
    );
    let mut second = database.new_agent_session().unwrap();
    second.snapshot.resources_undo_available = true;
    database.save_agent_chat(&second).unwrap();
    database.connection().unwrap().execute_batch(
        "CREATE TRIGGER reject_undo_update BEFORE UPDATE OF snapshot_json ON agent_chat BEGIN SELECT RAISE(ABORT,'write failure'); END;",
    ).unwrap();
    assert!(database.select_agent_session(&first.id).is_err());
    assert_eq!(database.agent_chat().unwrap().id, second.id);
    assert!(
        database
            .agent_chat()
            .unwrap()
            .snapshot
            .resources_undo_available
    );
    database
        .connection()
        .unwrap()
        .execute_batch("DROP TRIGGER reject_undo_update;")
        .unwrap();
    assert!(
        !database
            .select_agent_session(&first.id)
            .unwrap()
            .snapshot
            .resources_undo_available
    );
    assert!(
        !database
            .agent_chat()
            .unwrap()
            .snapshot
            .resources_undo_available
    );
    assert!(
        !database
            .delete_agent_session(&first.id)
            .unwrap()
            .snapshot
            .resources_undo_available
    );
    assert!(
        !database
            .agent_chat()
            .unwrap()
            .snapshot
            .resources_undo_available
    );
}

#[test]
fn capacity_evicts_by_creation_instead_of_recent_selection() {
    let database = database();
    let oldest = add_user(&database, "oldest").id;
    for index in 1..10 {
        database.new_agent_session().unwrap();
        add_user(&database, &format!("request {index}"));
    }
    database.select_agent_session(&oldest).unwrap();
    let newest = database.new_agent_session().unwrap();
    let sessions = database.agent_sessions().unwrap();
    assert_eq!(sessions.len(), 10);
    assert_eq!(sessions[0].id, newest.id);
    assert!(!sessions.iter().any(|session| session.id == oldest));
}

#[test]
fn failed_creation_rolls_back_eviction_and_selection() {
    let database = database();
    let oldest = add_user(&database, "oldest").id;
    for index in 1..10 {
        database.new_agent_session().unwrap();
        add_user(&database, &format!("request {index}"));
    }
    database.select_agent_session(&oldest).unwrap();
    database.connection().unwrap().execute_batch(
        "CREATE TRIGGER reject_new_chat BEFORE INSERT ON agent_chat BEGIN SELECT RAISE(ABORT,'write failure'); END;",
    ).unwrap();
    assert!(database.new_agent_session().is_err());
    assert_eq!(database.agent_sessions().unwrap().len(), 10);
    assert_eq!(database.agent_chat().unwrap().id, oldest);
}

#[test]
fn deleting_selected_uses_newest_remaining_and_last_creates_blank() {
    let database = database();
    let first = add_user(&database, "first");
    let second = database.new_agent_session().unwrap();
    database.select_agent_session(&first.id).unwrap();
    assert_eq!(
        database.delete_agent_session(&first.id).unwrap().id,
        second.id
    );
    let blank = database.delete_agent_session(&second.id).unwrap();
    assert_ne!(blank.id, second.id);
    assert!(blank.snapshot.messages.is_empty());
    assert_eq!(database.agent_sessions().unwrap().len(), 1);
    assert!(matches!(
        database.select_agent_session(&first.id),
        Err(PersistenceError::NotFound { .. })
    ));
    assert_eq!(database.agent_chat().unwrap().id, blank.id);
}

#[test]
fn session_deletion_releases_only_its_media_references() {
    let database = database();
    let mut first = add_user(&database, "image");
    {
        let connection = database.connection().unwrap();
        connection
            .execute(
                "INSERT INTO media_blobs(id,byte_length) VALUES('blob',1)",
                [],
            )
            .unwrap();
        connection.execute("INSERT INTO media_assets(id,blob_id,kind,mime_type,created_at,source) VALUES('asset','blob','image','image/png',0,'{}')", []).unwrap();
    }
    first.snapshot.messages[0].asset_ids.push("asset".into());
    database.save_agent_chat(&first).unwrap();
    database.new_agent_session().unwrap();
    let mut second = add_user(&database, "same image");
    second.snapshot.messages[0].asset_ids.push("asset".into());
    database.save_agent_chat(&second).unwrap();
    database.delete_agent_session(&first.id).unwrap();
    let connection = database.connection().unwrap();
    let owners: Vec<String> = connection
        .prepare("SELECT owner_id FROM media_references WHERE owner_kind='agent'")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(owners, [second.id]);
}

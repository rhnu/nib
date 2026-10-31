use super::*;

#[test]
fn indexed_categories_follow_keys_instead_of_database_order() {
    let keys = vec!["second".into(), "first".into()];
    let kinds = indexed_kinds(
        &keys,
        [
            Ok(("first".into(), "artist".into())),
            Ok(("unindexed".into(), "unsupported".into())),
            Ok(("second".into(), "character".into())),
        ],
    )
    .unwrap();
    assert_eq!(kinds.len(), 2);
    assert_eq!(kinds["first"], LexiconKind::Artist);
    assert_eq!(kinds["second"], LexiconKind::Character);
}

#[test]
fn indexed_categories_reject_missing_and_invalid_terms() {
    let keys = vec!["first".into()];
    assert!(indexed_kinds(&keys, []).is_err());
    assert!(indexed_kinds(&keys, [Ok(("first".into(), "unsupported".into()))]).is_err());
    assert!(indexed_kinds(&keys, [Err(rusqlite::Error::InvalidQuery)]).is_err());
}

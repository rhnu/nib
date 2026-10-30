use super::*;

fn query(limit: u32, text: String) -> LexiconQuery {
    LexiconQuery {
        text,
        kinds: Vec::new(),
        semantic: false,
        limit,
        related_to: None,
    }
}

#[test]
fn invalid_queries_are_rejected_before_reading_resources() {
    let resources = LexiconResources::default();
    for query in [
        query(0, String::new()),
        query(101, String::new()),
        query(1, "a".repeat(2049)),
    ] {
        assert!(matches!(
            resources.search(query),
            Err(LexiconError::Invalid(_))
        ));
    }
}

#[test]
fn valid_queries_without_an_installation_have_no_matches() {
    let resources = LexiconResources::default();
    for query in [query(1, String::new()), query(100, "a".repeat(2048))] {
        let result = resources.search(query).unwrap();
        assert!(result.matches.is_empty());
        assert!(result.generation.is_none());
        assert!(!result.semantic_available);
    }
}

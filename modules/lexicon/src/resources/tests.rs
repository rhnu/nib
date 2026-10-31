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

#[test]
fn restore_state_distinguishes_loading_failure_and_uninstalled() {
    let resources = LexiconResources::default();
    let status = resources.status().unwrap();
    assert!(!status.loading);
    assert!(status.error.is_none());
    resources.restore_started();
    let status = resources.status().unwrap();
    assert!(status.loading);
    assert!(status.generation.is_none());
    resources.restore_failed("corrupt vocabulary");
    let status = resources.status().unwrap();
    assert!(!status.loading);
    assert!(status.error.is_some());
    resources.restore_started();
    assert!(resources.status().unwrap().error.is_none());
    resources.deactivate();
    assert!(!resources.status().unwrap().loading);
}

fn manifests() -> (ResourceManifest, nib_resources::format::ResourceManifest) {
    let core = crate::format::ResourceFile {
        path: "vocabulary.sqlite3".into(),
        bytes: 5,
        sha256: "a".repeat(64),
    };
    let manifest = ResourceManifest {
        format_version: crate::format::FORMAT_VERSION,
        id: "1.0.0".into(),
        core: core.clone(),
        semantic: None,
        model: None,
        sources: Vec::new(),
    };
    let file = |path, bytes, sha256| nib_resources::format::ResourceFile {
        path,
        bytes,
        sha256,
        url: "https://example.test/resource".into(),
    };
    let resource = nib_resources::format::ResourceManifest {
        schema_version: 1,
        id: "lexicon".into(),
        version: manifest.id.clone(),
        components: vec![nib_resources::format::ResourceComponent {
            id: "core".into(),
            name: "Core".into(),
            description: String::new(),
            requires: Vec::new(),
            files: vec![
                file("lexicon.json".into(), 1, "b".repeat(64)),
                file(core.path, core.bytes, core.sha256),
            ],
        }],
    };
    (manifest, resource)
}

#[test]
fn domain_file_declarations_must_match_verified_downloads() {
    let (manifest, resource) = manifests();
    let components = vec!["core".into()];
    validate_file_declarations(&manifest, &resource, &components).unwrap();
    let mut wrong_size = manifest.clone();
    wrong_size.core.bytes += 1;
    assert!(validate_file_declarations(&wrong_size, &resource, &components).is_err());
    let mut wrong_digest = manifest.clone();
    wrong_digest.core.sha256 = "c".repeat(64);
    assert!(validate_file_declarations(&wrong_digest, &resource, &components).is_err());
    let mut missing = manifest.clone();
    missing.core.path = "missing.sqlite3".into();
    assert!(validate_file_declarations(&missing, &resource, &components).is_err());
    assert!(validate_file_declarations(&manifest, &resource, &["semantic".into()]).is_err());
}

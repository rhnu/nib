use std::{error::Error as _, io};

use super::*;

fn store(state: State) -> ResourceStore {
    ResourceStore {
        directory: PathBuf::new(),
        state: Mutex::new(state),
        consumers: BTreeMap::new(),
        refreshing: Mutex::new(()),
        cache: Mutex::new(()),
    }
}

fn catalog() -> State {
    State {
        catalog: vec![(
            CatalogResource {
                id: "lexicon".into(),
                name: String::new(),
                description: String::new(),
                version: "1".into(),
                manifest: format::ResourceFile {
                    path: "resource.json".into(),
                    url: String::new(),
                    bytes: 0,
                    sha256: String::new(),
                },
            },
            ResourceManifest {
                schema_version: format::SCHEMA_VERSION,
                id: "lexicon".into(),
                version: "1".into(),
                components: vec![format::ResourceComponent {
                    id: "core".into(),
                    name: String::new(),
                    description: String::new(),
                    requires: Vec::new(),
                    files: Vec::new(),
                }],
            },
        )],
        ..State::default()
    }
}

#[test]
fn installation_request_errors_keep_their_categories() {
    let store = store(catalog());
    assert!(matches!(
        store.begin_install("missing", &["core".into()]),
        Err(ResourceError::NotFound(_))
    ));
    for components in [Vec::new(), vec!["unknown".into()]] {
        let error = store.begin_install("lexicon", &components).unwrap_err();
        assert!(matches!(error, ResourceError::Invalid(_)));
        assert!(error.source().is_some());
    }
    store.begin_install("lexicon", &["core".into()]).unwrap();
    assert!(matches!(
        store.begin_install("lexicon", &["core".into()]),
        Err(ResourceError::Conflict(_))
    ));
    assert!(matches!(
        store.uninstall("lexicon"),
        Err(ResourceError::Conflict(_))
    ));
}

#[test]
fn missing_installations_are_not_found_and_cancellation_is_idempotent() {
    let store = store(State::default());
    assert!(matches!(
        store.uninstall("lexicon"),
        Err(ResourceError::NotFound(_))
    ));
    store.cancel("lexicon").unwrap();
    store.cancel("lexicon").unwrap();
}

#[test]
fn backend_failure_preserves_context_and_original_cause() {
    let error = ResourceError::from(
        anyhow::Error::new(io::Error::new(io::ErrorKind::PermissionDenied, "blocked"))
            .context("persist resource activation"),
    );
    assert!(matches!(error, ResourceError::Failure(_)));
    let context = error.source().unwrap();
    assert_eq!(context.to_string(), "persist resource activation");
    let cause = context
        .source()
        .unwrap()
        .downcast_ref::<io::Error>()
        .unwrap();
    assert_eq!(cause.kind(), io::ErrorKind::PermissionDenied);
}

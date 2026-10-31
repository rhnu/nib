use std::{
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use super::*;
use crate::{
    ResourceConsumer, ResourceRestoreStatus, State,
    format::{CatalogResource, ResourceComponent, ResourceFile, ResourceManifest, SCHEMA_VERSION},
};

#[derive(Default)]
struct Consumer {
    started: AtomicUsize,
    failed: AtomicUsize,
    prepared: AtomicUsize,
}

impl ResourceConsumer for Consumer {
    fn prepare(
        &self,
        _generation: Arc<ResourceGeneration>,
        _preparation: Preparation,
    ) -> Result<Box<dyn PreparedResource>> {
        self.prepared.fetch_add(1, Ordering::Relaxed);
        anyhow::bail!("metadata recovery must not prepare consumers");
    }

    fn restore_started(&self) { self.started.fetch_add(1, Ordering::Relaxed); }

    fn restore_failed(&self, _message: &str) { self.failed.fetch_add(1, Ordering::Relaxed); }

    fn deactivate(&self) {}
}

struct Prepared(Arc<AtomicUsize>);

impl PreparedResource for Prepared {
    fn activate(self: Box<Self>) { self.0.fetch_add(1, Ordering::Relaxed); }
}

fn record() -> InstalledResource {
    let file = |path: &str| ResourceFile {
        path: path.into(),
        url: format!("https://example.com/{path}"),
        bytes: 1,
        sha256: "a".repeat(64),
    };
    InstalledResource {
        resource: CatalogResource {
            id: "example".into(),
            name: "Example".into(),
            description: String::new(),
            version: "1".into(),
            manifest: file("resource.json"),
        },
        manifest: ResourceManifest {
            schema_version: SCHEMA_VERSION,
            id: "example".into(),
            version: "1".into(),
            components: vec![ResourceComponent {
                id: "core".into(),
                name: String::new(),
                description: String::new(),
                requires: Vec::new(),
                files: vec![file("missing.bin")],
            }],
        },
        components: vec!["core".into()],
        generation: "b".repeat(64),
    }
}

fn store() -> (ResourceStore, Arc<Consumer>) {
    let consumer = Arc::new(Consumer::default());
    let store = ResourceStore {
        directory: PathBuf::new(),
        state: Mutex::new(State::default()),
        consumers: [(
            "example".into(),
            Arc::clone(&consumer) as Arc<dyn ResourceConsumer>,
        )]
        .into_iter()
        .collect(),
        refreshing: Mutex::new(()),
        cache: Mutex::new(()),
    };
    (store, consumer)
}

fn loading(store: &ResourceStore) -> Arc<ResourceGeneration> {
    store.restore_metadata(record());
    let mut state = store.lock().unwrap();
    let installed = state.installed.get_mut("example").unwrap();
    installed.restoration = Restoration::Loading;
    Arc::clone(&installed.lease)
}

fn restoration_status(store: &ResourceStore) -> Option<ResourceRestoreStatus> {
    store
        .status()
        .unwrap()
        .resources
        .into_iter()
        .find(|resource| resource.id == "example")
        .map(|resource| ResourceRestoreStatus {
            loading: resource.loading,
            error: resource.error,
        })
}

#[test]
fn metadata_recovery_retains_missing_files_without_preparing_consumers() {
    let (store, consumer) = store();
    assert!(restoration_status(&store).is_none());
    store.restore_metadata(record());
    assert_eq!(
        restoration_status(&store),
        Some(ResourceRestoreStatus {
            loading: true,
            error: None
        })
    );
    let status = store.status().unwrap();
    let resource = &status.resources[0];
    assert_eq!(resource.installed_version.as_deref(), Some("1"));
    assert!(resource.loading);
    assert!(resource.install.is_none());
    assert_eq!(consumer.started.load(Ordering::Relaxed), 1);
    assert_eq!(consumer.failed.load(Ordering::Relaxed), 0);
    assert_eq!(consumer.prepared.load(Ordering::Relaxed), 0);
}

#[test]
fn current_restore_activates_once_and_finishes_loading() {
    let (store, _) = store();
    let lease = loading(&store);
    let activated = Arc::new(AtomicUsize::new(0));
    assert!(
        store
            .finish_restore(&lease, Ok(Some(Box::new(Prepared(Arc::clone(&activated))))))
            .unwrap()
    );
    assert!(
        !store
            .finish_restore(&lease, Ok(Some(Box::new(Prepared(Arc::clone(&activated))))))
            .unwrap()
    );
    assert_eq!(activated.load(Ordering::Relaxed), 1);
    assert_eq!(
        restoration_status(&store),
        Some(ResourceRestoreStatus::default())
    );
}

#[test]
fn restore_failure_has_separate_status_and_preserves_installation() {
    let (store, consumer) = store();
    let lease = loading(&store);
    assert!(
        !store
            .finish_restore(&lease, Err(anyhow::anyhow!("unreadable resource")))
            .unwrap()
    );
    let status = restoration_status(&store).unwrap();
    assert!(!status.loading);
    assert!(status.error.is_some());
    assert_eq!(consumer.failed.load(Ordering::Relaxed), 1);
    let status = store.status().unwrap();
    assert!(status.resources[0].installed_version.is_some());
    assert!(status.resources[0].install.is_none());
}

#[test]
fn replacement_or_removal_rejects_old_restore_activation_and_failure() {
    for replacement in [false, true] {
        let (store, consumer) = store();
        let old = loading(&store);
        store.lock().unwrap().installed.remove("example");
        if replacement {
            // Even a replacement with an identical generation name has a distinct lease.
            store.restore_metadata(record());
        }
        let activated = Arc::new(AtomicUsize::new(0));
        assert!(
            !store
                .finish_restore(&old, Ok(Some(Box::new(Prepared(Arc::clone(&activated))))))
                .unwrap()
        );
        assert!(
            !store
                .finish_restore(&old, Err(anyhow::anyhow!("old failure")))
                .unwrap()
        );
        assert_eq!(activated.load(Ordering::Relaxed), 0);
        assert_eq!(consumer.failed.load(Ordering::Relaxed), 0);
        assert_eq!(restoration_status(&store).is_some(), replacement);
        if replacement {
            assert!(restoration_status(&store).unwrap().loading);
        }
    }
}

#[test]
fn failed_worker_finishes_pending_and_loading_generations_without_changing_ready_ones() {
    for ready in [false, true] {
        let (store, consumer) = store();
        let lease = loading(&store);
        if ready {
            assert!(store.finish_restore(&lease, Ok(None)).unwrap());
        }
        store.restore_worker_failed("worker stopped").unwrap();
        let status = restoration_status(&store).unwrap();
        assert!(!status.loading);
        assert_eq!(status.error.is_some(), !ready);
        assert_eq!(consumer.failed.load(Ordering::Relaxed), usize::from(!ready));
    }
    let (store, consumer) = store();
    store.restore_metadata(record());
    store.restore_worker_failed("worker did not start").unwrap();
    assert!(!restoration_status(&store).unwrap().loading);
    assert_eq!(consumer.failed.load(Ordering::Relaxed), 1);
}

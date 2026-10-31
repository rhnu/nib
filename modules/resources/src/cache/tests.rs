use std::{
    collections::HashSet,
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
};

use super::{object_digest, retained_objects};
use crate::{
    Installed, InstalledResource, ResourceGeneration, State,
    format::{CatalogResource, ResourceComponent, ResourceFile, ResourceManifest, SCHEMA_VERSION},
};

fn resource(
    version: &str,
    manifest_digest: &str,
    components: &[(&str, &str)],
) -> (CatalogResource, ResourceManifest) {
    let file = |path: &str, digest: &str| ResourceFile {
        path: path.into(),
        url: format!("https://example.com/{version}/{path}"),
        bytes: 1,
        sha256: digest.into(),
    };
    (
        CatalogResource {
            id: "example".into(),
            name: String::new(),
            description: String::new(),
            version: version.into(),
            manifest: file("resource.json", manifest_digest),
        },
        ResourceManifest {
            schema_version: SCHEMA_VERSION,
            id: "example".into(),
            version: version.into(),
            components: components
                .iter()
                .map(|(id, digest)| ResourceComponent {
                    id: (*id).into(),
                    name: String::new(),
                    description: String::new(),
                    requires: Vec::new(),
                    files: vec![file(&format!("{id}.bin"), digest)],
                })
                .collect(),
        },
    )
}

#[test]
fn completed_and_resumable_objects_share_a_content_identity() {
    let digest = "a".repeat(64);
    for name in [
        digest.clone(),
        format!("{digest}.part"),
        format!("{digest}.etag"),
    ] {
        assert_eq!(object_digest(&name), Some(digest.as_str()));
    }
    for name in ["../outside", "note.txt", "a.part", ""] {
        assert_eq!(object_digest(name), None);
    }
}

#[test]
fn retained_objects_include_current_catalog_installed_selection_and_inflight_selection() {
    let hashes: Vec<_> = ['a', 'b', 'c', 'd', 'e', 'f', '0', '1', '2', '3']
        .into_iter()
        .map(|value| value.to_string().repeat(64))
        .collect();
    let (installed_resource, installed_manifest) = resource(
        "1",
        &hashes[3],
        &[("core", &hashes[4]), ("unused", &hashes[5])],
    );
    let components = vec!["core".to_owned()];
    let installed = Installed {
        record: InstalledResource {
            resource: installed_resource,
            manifest: installed_manifest,
            components: components.clone(),
            generation: "installed".into(),
        },
        lease: Arc::new(ResourceGeneration {
            directory: PathBuf::new(),
            id: "example".into(),
            version: "1".into(),
            components,
            generation: "installed".into(),
            // This pure test must never remove a generation directory when its lease drops.
            retired: AtomicBool::new(false),
        }),
    };
    let (task_resource, task_manifest) = resource(
        "2",
        &hashes[6],
        &[("core", &hashes[7]), ("unused", &hashes[8])],
    );
    let state = State {
        catalog: vec![resource(
            "3",
            &hashes[0],
            &[("core", &hashes[1]), ("optional", &hashes[2])],
        )],
        installed: [("example".into(), installed)].into_iter().collect(),
        task: Some("example".into()),
        task_manifest: Some((task_resource, task_manifest, vec!["core".into()])),
        ..State::default()
    };
    let retained = retained_objects(&state).unwrap();
    assert_eq!(
        retained,
        [0, 1, 2, 3, 4, 6, 7]
            .map(|index| hashes[index].as_str())
            .into_iter()
            .collect::<HashSet<_>>()
    );
    for index in [5, 8, 9] {
        assert!(!retained.contains(hashes[index].as_str()));
    }
}

#[test]
fn catalog_error_preserves_all_objects_instead_of_producing_a_cleanup_selection() {
    let state = State {
        catalog_error: Some("unreadable metadata".into()),
        ..State::default()
    };
    assert!(retained_objects(&state).is_none());
    assert_eq!(retained_objects(&State::default()), Some(HashSet::new()));
}

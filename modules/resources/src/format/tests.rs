use super::*;

fn manifest() -> ResourceManifest {
    ResourceManifest {
        schema_version: 1,
        id: "example".into(),
        version: "1.0.0".into(),
        components: [
            ("core", Vec::new(), "data.bin"),
            ("search", vec!["core".to_owned()], "index.bin"),
        ]
        .into_iter()
        .map(|(id, requires, path)| ResourceComponent {
            id: id.into(),
            name: id.into(),
            description: String::new(),
            requires,
            files: vec![ResourceFile {
                path: path.into(),
                url: format!("https://example.com/{path}"),
                bytes: 10,
                sha256: "ab".repeat(32),
            }],
        })
        .collect(),
    }
}

#[test]
fn selection_includes_dependencies_without_keeping_unselected_components() {
    let resource = manifest();
    assert_eq!(
        resource.selection(&["search".into()]).unwrap(),
        ["core", "search"]
    );
    assert_eq!(resource.selection(&["core".into()]).unwrap(), ["core"]);
    assert!(resource.selection(&[]).is_err());
    assert!(resource.selection(&["missing".into()]).is_err());
}

#[test]
fn invalid_dependencies_and_colliding_windows_paths_are_rejected() {
    let mut resource = manifest();
    resource.components[0].requires.push("search".into());
    assert!(resource.validate().is_err());
    resource.components[0].requires = vec!["missing".into()];
    assert!(resource.validate().is_err());
    resource.components[0].requires.clear();
    resource.components[1].files[0].path = "DATA.BIN".into();
    assert!(resource.validate().is_err());
}

#[test]
fn unsafe_paths_credentials_and_overflow_are_rejected() {
    for path in [
        "../secrets",
        "C:\\file",
        "a/b",
        ".private.json",
        "CON.txt",
        "thing.",
    ] {
        assert!(validate_path(path).is_err(), "{path}");
    }
    assert!(validate_url("https://user:secret@example.com/data").is_err());
    assert!(validate_url("http://example.com/data").is_err());
    let mut resource = manifest();
    resource.components[0].files[0].bytes = u64::MAX;
    assert!(resource.validate().is_err());
}

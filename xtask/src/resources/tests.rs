use nib_resources::format::{ResourceComponent, ResourceFile, ResourceManifest, SCHEMA_VERSION};

use super::{parse_version, publication_files, release_tag};

#[test]
fn resource_versions_require_three_unambiguous_numbers() {
    assert!(parse_version("1.0.0").is_ok());
    assert!(parse_version("0.12.34").is_ok());
    for value in [
        "1",
        "1.0",
        "01.0.0",
        "1.0.0-rc.1",
        "1.0.0+build",
        "1.0.0/other",
        "1.0.0\n",
    ] {
        assert!(parse_version(value).is_err(), "accepted {value:?}");
    }
}

#[test]
fn publication_targets_one_immutable_resource_release() {
    let tag = release_tag("palettes", "2.3.4");
    let mut manifest = ResourceManifest {
        schema_version: SCHEMA_VERSION,
        id: "palettes".into(),
        version: "2.3.4".into(),
        components: vec![ResourceComponent {
            id: "core".into(),
            name: "Palettes".into(),
            description: String::new(),
            requires: Vec::new(),
            files: vec![ResourceFile {
                path: "colors.json".into(),
                url: format!("https://github.com/rhnu/nib/releases/download/{tag}/colors.json"),
                bytes: 4,
                sha256: "a".repeat(64),
            }],
        }],
    };
    assert_eq!(tag, "resource-palettes-v2.3.4");
    assert_eq!(
        publication_files(&manifest, "palettes", "2.3.4")
            .unwrap()
            .len(),
        1
    );
    assert!(publication_files(&manifest, "palettes", "2.3.5").is_err());
    assert!(publication_files(&manifest, "other", "2.3.4").is_err());
    manifest.components[0].files[0].url = "https://example.com/colors.json".into();
    assert!(publication_files(&manifest, "palettes", "2.3.4").is_err());
}

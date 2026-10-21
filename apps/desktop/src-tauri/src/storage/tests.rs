use std::path::Path;

use super::{migration_target, readable_path, validate_directory_relationship};

#[test]
fn relocation_rejects_overlapping_directories() {
    let source = Path::new("/nib/data");
    let config = Path::new("/nib/config");
    for target in ["/nib", "/nib/data/media", "/nib/config", "/nib/config/data"] {
        assert!(validate_directory_relationship(Path::new(target), source, config).is_err());
    }
}

#[test]
fn sibling_directories_and_current_directory_are_allowed() {
    let source = Path::new("/nib/data");
    let config = Path::new("/nib/config");
    for target in ["/nib/relocated", "/nib/data", "/nib/database"] {
        assert!(validate_directory_relationship(Path::new(target), source, config).is_ok());
    }
}

#[test]
fn displayed_windows_paths_remain_usable_as_absolute_paths() {
    assert_eq!(
        readable_path(r"\\?\C:\Users\nib\data"),
        r"C:\Users\nib\data"
    );
    assert_eq!(
        readable_path(r"\\?\UNC\server\share\data"),
        r"\\server\share\data"
    );
}

#[test]
fn only_an_unchanged_startup_request_can_relocate_data() {
    let original = Path::new("/storage/original");
    let new = Path::new("/storage/new");
    assert_eq!(
        migration_target(Some(original), Some(original)),
        Some(original)
    );
    assert_eq!(migration_target(None, Some(new)), None);
    assert_eq!(migration_target(Some(original), Some(new)), None);
    assert_eq!(migration_target(Some(original), None), None);
}

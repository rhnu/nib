use super::*;

#[test]
fn resource_paths_stay_in_the_generation_directory() {
    for path in [
        "../secrets",
        "C:\\file",
        "a/b",
        ".nib-manifest.json",
        "CON.txt",
        "thing.",
    ] {
        assert!(validate_path(path).is_err(), "{path}");
    }
    for path in ["model_q4.onnx_data", "tokenizer.json.gz", "LICENSE"] {
        assert!(validate_path(path).is_ok(), "{path}");
    }
}

#[test]
fn content_hashes_have_one_canonical_form() {
    assert!(valid_hash(&"ab".repeat(32)));
    assert!(!valid_hash(&"AB".repeat(32)));
    assert!(!valid_hash("1234"));
}

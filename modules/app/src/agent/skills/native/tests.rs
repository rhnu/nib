use super::frontmatter;

#[test]
fn yaml_supports_block_descriptions_and_extra_metadata() {
    let fields = frontmatter("---\nname: Painter\ndescription: >-\n  Read a palette\n  and compose a scene.\nmetadata:\n  owner: user\n---\nBody is loaded separately.").unwrap();
    assert_eq!(fields.name, "Painter");
    assert_eq!(fields.description, "Read a palette and compose a scene.");
}

#[test]
fn rejects_missing_frontmatter_and_required_fields() {
    assert!(frontmatter("# No YAML").is_err());
    assert!(frontmatter("---\nname: Painter\n---\nBody").is_err());
    assert!(frontmatter("---\nname: Painter\ndescription: ''\n---").is_err());
}

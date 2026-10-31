use super::*;

#[test]
fn extracted_tags_use_novelai_names_and_descending_confidence() {
    let tags = select_tags(
        vec![
            RawTag {
                name: "blue_hair".to_owned(),
                confidence: 0.6,
            },
            RawTag {
                name: "red_eyes".to_owned(),
                confidence: 0.9,
            },
            RawTag {
                name: "low_confidence".to_owned(),
                confidence: 0.1,
            },
        ],
        0.5,
    );
    assert_eq!(tags.len(), 2);
    assert_eq!(tags[0].name, "red_eyes");
    assert_eq!(tags[0].prompt_text, "red eyes");
    assert_eq!(tags[1].prompt_text, "blue hair");
}

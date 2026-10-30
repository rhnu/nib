use crate::{PromptContext, PromptSyntaxProfile, analyze};

#[test]
fn tags_keep_utf16_offsets_and_do_not_replace_syntax_or_comments() {
    let source = "😀, {blue eyes}, /* ignored */ 1.2::red hair::, text:hello";
    let document = analyze(
        source,
        PromptSyntaxProfile {
            bracket_weights: true,
            numeric_weights: true,
            text_rendering: true,
            ..PromptSyntaxProfile::default()
        },
        PromptContext::Editable,
    );
    let source: Vec<u16> = source.encode_utf16().collect();
    let tags: Vec<String> = document
        .completion_ranges
        .iter()
        .filter(|range| range.from < range.to)
        .map(|range| {
            String::from_utf16(
                &source[usize::try_from(range.from).unwrap()..usize::try_from(range.to).unwrap()],
            )
            .unwrap()
        })
        .collect();
    assert_eq!(tags, ["😀", "blue eyes", "red hair"]);
}

#[test]
fn escaped_separators_are_not_plain_tag_ranges() {
    let document = analyze(
        "blue\\,eyes, green",
        PromptSyntaxProfile::default(),
        PromptContext::Editable,
    );
    assert!(
        document
            .completion_ranges
            .iter()
            .all(|range| range.to <= 4 || range.from >= 6)
    );
}

#[test]
fn trailing_whitespace_allows_insertion_after_the_previous_tag() {
    let source = "blue eyes,  ";
    let document = analyze(
        source,
        PromptSyntaxProfile::default(),
        PromptContext::Editable,
    );
    let end = u32::try_from(source.encode_utf16().count()).unwrap();
    assert!(
        document
            .completion_ranges
            .iter()
            .any(|range| range.from == end && range.to == end)
    );
}

#[test]
fn uncertain_rendering_after_randomizer_is_not_a_tag() {
    let source = "||text:hello|blue eyes|| ending";
    let document = analyze(
        source,
        PromptSyntaxProfile {
            text_rendering: true,
            randomizer: true,
            ..PromptSyntaxProfile::default()
        },
        PromptContext::Editable,
    );
    let source: Vec<u16> = source.encode_utf16().collect();
    let tags: Vec<String> = document
        .completion_ranges
        .iter()
        .filter(|range| range.from < range.to)
        .map(|range| {
            String::from_utf16(
                &source[usize::try_from(range.from).unwrap()..usize::try_from(range.to).unwrap()],
            )
            .unwrap()
        })
        .collect();
    assert_eq!(tags, ["blue eyes"]);
}

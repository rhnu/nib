use super::*;
use crate::{PromptContext, PromptTokenKind, PromptWeight, analyze};

fn modern() -> PromptSyntaxProfile {
    PromptSyntaxProfile {
        bracket_weights: true,
        text_rendering: true,
        character_separators: true,
        numeric_weights: true,
        negative_weights: true,
        randomizer: true,
        ..Default::default()
    }
}

#[test]
fn comments_preserve_words_crlf_urls_and_ordinary_quotes() {
    let compiled = compile(
        "猫/* note */dog // end\r\nhttps://a/b a//b \" // comment\nemoji😀",
        modern(),
    );
    assert_eq!(compiled.text, "猫 dog \r\nhttps://a/b a//b \" \nemoji😀");
    assert_eq!(compiled.comments.len(), 3);
    assert_eq!(compiled.diagnostics, []);
}

#[test]
fn unfinished_comment_is_a_typed_error_and_cannot_swallow_another_fragment() {
    let compiled = compile_fragments(["cat /* unfinished", "dog"], modern());
    assert_eq!(compiled.text, "cat\ndog");
    assert_eq!(
        compiled.diagnostics[0].code,
        SourceDiagnosticCode::UnclosedBlockComment
    );
    assert_eq!(compiled.diagnostics[0].from, 4);
    assert_eq!(compiled.diagnostics[0].to, 17);
}

#[test]
fn comments_do_not_reset_native_weight_state() {
    let compiled = compile_fragments(["2::cat /* note */", "dog::"], modern());
    let analysis = compiled.map_analysis(novelai_bridge_prompt::analyze_prompt(
        &compiled.text,
        modern(),
    ));
    let dog = analysis
        .spans
        .iter()
        .find(|span| span.from <= 18 && span.to >= 21)
        .unwrap();
    assert_eq!(dog.weight, PromptWeight::Exact { value: 2.0 });
}

#[test]
fn source_ranges_use_utf16_and_skip_removed_comments_and_escape_prefixes() {
    let compiled = compile("😀猫/*x*/犬 \\/* literal", modern());
    assert_eq!(compiled.text, "😀猫 犬 /* literal");
    let ranges = compiled.source_ranges(TextRange { from: 0, to: 5 });
    assert_eq!(
        ranges,
        [TextRange { from: 0, to: 3 }, TextRange { from: 8, to: 9 }]
    );
    let doc = analyze("😀猫/*x*/犬", modern(), PromptContext::Editable);
    assert!(
        doc.analysis
            .tokens
            .iter()
            .any(|token| token.from == 8 && token.to == 9 && token.text == "犬")
    );
}

#[test]
fn literal_rendering_preserves_comment_markers_until_native_field_separator() {
    let source = "// Text: ignored\nText: cat // shown /* shown */ \\| still text || pair || | dog // removed";
    let compiled = compile(source, modern());
    assert_eq!(
        compiled.text,
        "\nText: cat // shown /* shown */ \\| still text || pair || | dog "
    );
    assert_eq!(compiled.comments.len(), 2);
}

#[test]
fn native_restore_roundtrips_markers_escapes_unicode_and_rendering() {
    for profile in [modern(), PromptSyntaxProfile::default()] {
        for text in [
            "cat // literal",
            "a/*b*/c",
            "\\// \\\\/*",
            "///**/",
            "Text: // /* \\| || | cat // literal",
            "😀猫\r\n/*x*/",
            "\\Text: // literal",
            "||Text: a|b|| /* literal */",
            "||Text: a|b|| // literal",
        ] {
            let source = native_to_source(text, profile);
            let compiled = compile(&source, profile);
            assert_eq!(compiled.text, text, "source: {source:?}");
            assert_eq!(compiled.diagnostics, []);
        }
    }
}

#[test]
fn uncertain_rendering_preserves_markers_and_reports_a_typed_source_error() {
    let compiled = compile("||Text: a|b|| /* comment or text */", modern());
    assert_eq!(compiled.text, "||Text: a|b|| /* comment or text */");
    assert_eq!(
        compiled.diagnostics[0].code,
        SourceDiagnosticCode::AmbiguousCommentContext
    );
    assert_eq!(compiled.comments, []);
    let escaped = compile("||Text: a|b|| \\/* literal */", modern());
    assert_eq!(escaped.text, "||Text: a|b|| /* literal */");
    assert_eq!(escaped.diagnostics, []);
    let outside = compile("||Text: a|b|| | cat /* comment */", modern());
    assert_eq!(outside.diagnostics, []);
    assert_eq!(outside.comments.len(), 1);
}

#[test]
fn native_rendering_and_randomizer_context_continue_across_source_fragments() {
    let compiled = compile_fragments(["Text: 猫", "// rendered words"], modern());
    assert_eq!(compiled.text, "Text: 猫\n// rendered words");
    assert_eq!(compiled.comments, []);
    let compiled = compile_fragments(["||Text: cat", "|dog|| /* ambiguous */"], modern());
    assert_eq!(
        compiled.diagnostics[0].code,
        SourceDiagnosticCode::AmbiguousCommentContext
    );
    let compiled = compile_fragments(["cat /* unfinished", "dog /* local */"], modern());
    assert_eq!(compiled.comments.len(), 2);
    assert_eq!(compiled.diagnostics.len(), 1);
    assert_eq!(compiled.text, "cat\ndog");
}

#[test]
fn native_analysis_never_interprets_nib_comments() {
    let doc = analyze("cat /* original metadata", modern(), PromptContext::Native);
    assert!(doc.valid);
    assert_eq!(doc.text, "cat /* original metadata");
    assert_eq!(doc.comments, []);
    assert!(
        doc.analysis
            .tokens
            .iter()
            .any(|token| token.kind == PromptTokenKind::Text)
    );
}

#[test]
fn a_comment_cannot_activate_text_rendering() {
    let compiled = compile("cat /* Text: */ dog // note", modern());
    assert_eq!(compiled.text, "cat   dog ");
    assert_eq!(compiled.comments.len(), 2);
    let compiled = compile("cat/*comment*/Text: // shown", modern());
    assert_eq!(compiled.text, "cat Text: // shown");
}

#[test]
fn many_comments_keep_each_unicode_token_fragment_and_utf16_position() {
    let doc = analyze("猫/*a*/😀/*b*/犬/*c*/鳥", modern(), PromptContext::Editable);
    let text = doc
        .analysis
        .tokens
        .iter()
        .map(|token| token.text.as_str())
        .collect::<String>();
    assert_eq!(text, "猫😀犬鳥");
    for (from, to, text) in [(0, 1, "猫"), (6, 8, "😀"), (13, 14, "犬"), (19, 20, "鳥")] {
        assert!(
            doc.analysis
                .tokens
                .iter()
                .any(|token| token.from == from && token.to == to && token.text == text)
        );
    }
}

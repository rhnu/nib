use super::*;

fn modern() -> PromptSyntaxProfile {
    PromptSyntaxProfile {
        bracket_weights: true,
        numeric_weights: true,
        negative_weights: true,
        character_separators: true,
        randomizer: true,
        text_rendering: true,
        ..PromptSyntaxProfile::default()
    }
}

#[test]
fn normalizes_comma_spacing_without_changing_tags_or_separators() {
    for (source, expected) in [
        ("a ,b,   c", "a, b, c"),
        ("a\t,\tb", "a, b"),
        ("a,   \nb", "a,\nb"),
        ("a,   ", "a,"),
        ("{a ,b,   }", "{a, b,}"),
        ("1.2::a,b, ::", "1.2::a, b,::"),
        ("a,   |b,c", "a,|b, c"),
        ("||a,b, |c,d, ||", "||a, b,|c, d,||"),
        ("a, ,b,,c", "a,, b,, c"),
        ("a，b  c", "a，b  c"),
    ] {
        assert_eq!(format_prompt(source, modern(), &[]).unwrap().text, expected);
    }
}

#[test]
fn caps_logical_line_breaks_and_recognizes_whitespace_only_lines() {
    for (source, expected) in [
        ("a\n\n\n\nb", "a\n\nb"),
        ("a\n \n\t\n  b", "a\n\n  b"),
        ("a\r\n\r\n\r\nb", "a\r\n\r\nb"),
        ("\n\n\na\n\n\n", "\n\na\n\n"),
        ("a\nb", "a\nb"),
    ] {
        assert_eq!(format_prompt(source, modern(), &[]).unwrap().text, expected);
    }
}

#[test]
fn preserves_comments_escapes_and_literal_rendered_text() {
    for (source, expected) in [
        ("a,b // c,d\ne,f", "a, b // c,d\ne, f"),
        ("a,  // c,d\ne,f", "a, // c,d\ne, f"),
        ("a,/* c,d\n\n\n */b,c", "a, /* c,d\n\n\n */b, c"),
        ("a,b /* unfinished,c", "a, b /* unfinished,c"),
        (r"a\,b,c", r"a\,b, c"),
        ("Text:a,b\n\n\nc,d|e,f", "Text:a,b\n\n\nc,d|e, f"),
        ("||Text:a,b|c,d||e,f", "||Text:a,b|c, d||e,f"),
        ("a,//literal,b", "a,//literal, b"),
        (r"a,\//literal,b", r"a, \//literal, b"),
    ] {
        assert_eq!(format_prompt(source, modern(), &[]).unwrap().text, expected);
    }
}

#[test]
fn inherits_native_state_but_not_comments_across_fragments() {
    let source = "hello,world\n\n\nagain|blue,green";
    assert_eq!(
        format_prompt(source, modern(), &["Text:".into()])
            .unwrap()
            .text,
        "hello,world\n\n\nagain|blue, green"
    );
    assert_eq!(
        format_prompt("a,b", modern(), &["// Text:".into()])
            .unwrap()
            .text,
        "a, b"
    );
    assert_eq!(
        format_prompt("a,b", modern(), &["/* Text:".into()])
            .unwrap()
            .text,
        "a, b"
    );
    assert_eq!(
        format_prompt("a,b|c,d||e,f", modern(), &["||Text:".into()])
            .unwrap()
            .text,
        "a,b|c, d||e,f"
    );
}

#[test]
fn rejects_ambiguous_comment_context_without_guessing() {
    assert_eq!(
        format_prompt("||Text:a|b|| // comment", modern(), &[]),
        Err(PromptFormatError::AmbiguousCommentContext)
    );
}

#[test]
fn edits_use_original_utf16_positions_and_are_idempotent() {
    let source = "😀 ,猫,犬\n \n\n鳥";
    let result = format_prompt(source, modern(), &[]).unwrap();
    assert_eq!(result.text, "😀, 猫, 犬\n\n鳥");
    assert_eq!(
        result.changes[0],
        PromptTextEdit {
            from: 2,
            to: 3,
            insert: String::new()
        }
    );
    assert_eq!(
        result.changes[1],
        PromptTextEdit {
            from: 4,
            to: 4,
            insert: " ".into()
        }
    );
    let repeated = format_prompt(&result.text, modern(), &[]).unwrap();
    assert_eq!(repeated.text, result.text);
    assert_eq!(repeated.changes, []);
    let mut units = source.encode_utf16().collect::<Vec<_>>();
    for change in result.changes.iter().rev() {
        units.splice(
            change.from as usize..change.to as usize,
            change.insert.encode_utf16(),
        );
    }
    assert_eq!(String::from_utf16(&units).unwrap(), "😀, 猫, 犬\n\n鳥");
}

#[test]
fn plain_profile_keeps_structural_characters_as_ordinary_text() {
    let result = format_prompt("Text:a,b, }", PromptSyntaxProfile::default(), &[]).unwrap();
    assert_eq!(result.text, "Text:a, b, }");
}

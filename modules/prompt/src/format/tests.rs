use crate::{
    LexiconFormatError, LexiconFormatTerm, PromptContext, PromptSyntaxProfile, PromptTokenKind,
    PromptWeight, analyze, format_lexicon_terms,
};

fn modern() -> PromptSyntaxProfile {
    PromptSyntaxProfile {
        bracket_weights: true,
        numeric_weights: true,
        negative_weights: true,
        text_rendering: true,
        character_separators: true,
        randomizer: true,
        interaction_tags: true,
        ..PromptSyntaxProfile::default()
    }
}

#[test]
fn literal_comment_names_survive_editable_compilation() {
    let profile = modern();
    let source = format_lexicon_terms(
        &[
            LexiconFormatTerm {
                name: "//literal".into(),
                weight: None,
            },
            LexiconFormatTerm {
                name: "/*literal*/".into(),
                weight: None,
            },
        ],
        profile,
    )
    .unwrap();
    let document = analyze(&source, profile, PromptContext::Editable);
    assert!(document.valid);
    assert_eq!(document.comments, []);
    assert_eq!(document.text, "//literal, /*literal*/");
}

#[test]
fn structural_characters_remain_literal_without_native_operators() {
    let profile = modern();
    let source = format_lexicon_terms(
        &[
            LexiconFormatTerm {
                name: "{artist}|1.2::name::||other||".into(),
                weight: None,
            },
            LexiconFormatTerm {
                name: "text:hello".into(),
                weight: None,
            },
            LexiconFormatTerm {
                name: "source#1".into(),
                weight: None,
            },
        ],
        profile,
    )
    .unwrap();
    let document = analyze(&source, profile, PromptContext::Editable);
    assert!(document.valid);
    assert_eq!(document.analysis.diagnostics, []);
    assert!(
        document
            .analysis
            .tokens
            .iter()
            .all(|token| matches!(token.kind, PromptTokenKind::Text | PromptTokenKind::Escape))
    );
}

#[test]
fn numeric_weights_are_applied_by_the_current_profile() {
    let profile = modern();
    let source = format_lexicon_terms(
        &[LexiconFormatTerm {
            name: "かな😀".into(),
            weight: Some(1.4),
        }],
        profile,
    )
    .unwrap();
    let document = analyze(&source, profile, PromptContext::Editable);
    assert!(document.valid);
    assert!(
        document
            .analysis
            .spans
            .iter()
            .all(|span| span.weight == PromptWeight::Exact { value: 1.4 })
    );
    assert!(document.text.contains("かな😀"));
}

#[test]
fn legacy_brackets_preserve_ordinary_unicode_and_explicit_layers() {
    let profile = PromptSyntaxProfile {
        bracket_weights: true,
        ..PromptSyntaxProfile::default()
    };
    let source = format_lexicon_terms(
        &[LexiconFormatTerm {
            name: "画師かな".into(),
            weight: Some(-2.0),
        }],
        profile,
    )
    .unwrap();
    assert_eq!(source, "[[画師かな]]");
    assert!(analyze(&source, profile, PromptContext::Editable).valid);
}

#[test]
fn unsupported_or_invalid_weights_fail_instead_of_changing_meaning() {
    let term = |weight| {
        [LexiconFormatTerm {
            name: "artist".into(),
            weight: Some(weight),
        }]
    };
    assert_eq!(
        format_lexicon_terms(&term(1.4), PromptSyntaxProfile::default()),
        Err(LexiconFormatError::WeightUnsupported)
    );
    assert_eq!(
        format_lexicon_terms(&term(f64::NAN), modern()),
        Err(LexiconFormatError::NonFiniteWeight)
    );
    assert_eq!(
        format_lexicon_terms(
            &term(0.5),
            PromptSyntaxProfile {
                bracket_weights: true,
                ..PromptSyntaxProfile::default()
            }
        ),
        Err(LexiconFormatError::InvalidBracketLayers)
    );
    assert_eq!(
        format_lexicon_terms(
            &term(-1.0),
            PromptSyntaxProfile {
                numeric_weights: true,
                ..PromptSyntaxProfile::default()
            }
        ),
        Err(LexiconFormatError::NegativeWeightUnsupported)
    );
}

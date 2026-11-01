//! Whitespace edits operate on original source, never on comment-stripped request text.

use serde::{Deserialize, Serialize};

use crate::{PromptSyntaxProfile, PromptTokenKind, SourceDiagnosticCode, analyze_prompt};

/// A replacement in the original source's UTF-16 coordinates, suitable for editor history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PromptTextEdit {
    pub from: u32,
    pub to: u32,
    pub insert: String,
}

/// Formatted source and ordered, non-overlapping edits; no changes means a history-free no-op.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PromptFormat {
    pub text: String,
    pub changes: Vec<PromptTextEdit>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum PromptFormatError {
    #[error("Resolve the ambiguous comment or text-rendering context before formatting.")]
    AmbiguousCommentContext,
}

/// Normalizes comma spacing and limits ordinary prompt whitespace to two line breaks.
/// Preceding sources belong to the same scope, in composition order; comments stay per-source.
///
/// # Errors
/// Rejects ambiguous comment contexts rather than guessing which source is literal.
pub fn format_prompt(
    source: &str,
    profile: PromptSyntaxProfile,
    preceding_sources: &[String],
) -> Result<PromptFormat, PromptFormatError> {
    let compiled = crate::source::compile_source_fragments(
        preceding_sources.iter().map(String::as_str).chain([source]),
        profile,
        false,
    );
    if compiled
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.code == SourceDiagnosticCode::AmbiguousCommentContext)
    {
        return Err(PromptFormatError::AmbiguousCommentContext);
    }
    let analysis = compiled.map_analysis(analyze_prompt(&compiled.text, profile));
    let offset = preceding_sources
        .iter()
        .map(|text| text.encode_utf16().count() + 1)
        .sum::<usize>();
    // Table entries at scalar boundaries translate SDK/browser offsets without splitting Unicode.
    let mut bytes = Vec::with_capacity(source.encode_utf16().count() + 1);
    for (byte, ch) in source.char_indices() {
        bytes.extend(std::iter::repeat_n(byte, ch.len_utf16()));
    }
    bytes.push(source.len());
    let mut edits = Vec::new();
    for (index, token) in analysis.tokens.iter().enumerate() {
        let from = token.from as usize;
        let to = token.to as usize;
        if token.kind != PromptTokenKind::Text || from < offset || to <= offset {
            continue;
        }
        // Compiled block comments retain mapped line breaks. Those still belong to the comment.
        let comment = compiled
            .comments
            .partition_point(|range| range.to <= token.from);
        if compiled
            .comments
            .get(comment)
            .is_some_and(|range| range.from < token.to)
        {
            continue;
        }
        let start = bytes[from - offset];
        let end = bytes[to - offset];
        let closing = analysis.tokens.get(index + 1).is_some_and(|next| {
            next.from == token.to
                && (matches!(
                    next.kind,
                    PromptTokenKind::WeightReset
                        | PromptTokenKind::MixWeight
                        | PromptTokenKind::MixSeparator
                        | PromptTokenKind::CharacterSeparator
                        | PromptTokenKind::RandomSeparator
                        | PromptTokenKind::RandomClose
                ) || matches!(next.text.as_str(), "}" | "]"))
        });
        format_text(source, start, end, closing, &mut edits);
    }
    let mut text = String::with_capacity(source.len());
    let mut previous = 0;
    let changes = edits
        .into_iter()
        .map(|(from, to, insert)| {
            text.push_str(&source[previous..from]);
            text.push_str(&insert);
            previous = to;
            PromptTextEdit {
                from: u32::try_from(bytes.partition_point(|byte| *byte < from)).unwrap_or(u32::MAX),
                to: u32::try_from(bytes.partition_point(|byte| *byte < to)).unwrap_or(u32::MAX),
                insert,
            }
        })
        .collect();
    text.push_str(&source[previous..]);
    Ok(PromptFormat { text, changes })
}

type ByteEdit = (usize, usize, String);

fn horizontal(byte: u8) -> bool { matches!(byte, b' ' | b'\t') }

fn comma_space(source: &str, next: usize, end: usize, closing: bool) -> &'static str {
    if next == source.len()
        || (next == end && closing)
        || matches!(source.as_bytes()[next], b'\r' | b'\n' | b',')
        // Adding whitespace here would turn literal // into a nib line comment.
        || (next < end && source[next..].starts_with("//"))
    {
        ""
    } else {
        " "
    }
}

fn replace(source: &str, from: usize, to: usize, insert: &str, edits: &mut Vec<ByteEdit>) {
    if &source[from..to] != insert {
        edits.push((from, to, insert.to_owned()));
    }
}

/// Each horizontal run is handled once, so adjacent commas cannot produce overlapping edits.
fn format_text(source: &str, start: usize, end: usize, closing: bool, edits: &mut Vec<ByteEdit>) {
    let bytes = source.as_bytes();
    let mut cursor = start;
    while cursor < end {
        let from = cursor;
        match bytes[cursor] {
            b' ' | b'\t' => {
                while cursor < end && horizontal(bytes[cursor]) {
                    cursor += 1;
                }
                let insert = if cursor < end && bytes[cursor] == b',' {
                    ""
                } else if from > start && bytes[from - 1] == b',' {
                    comma_space(source, cursor, end, closing)
                } else {
                    continue;
                };
                replace(source, from, cursor, insert, edits);
            },
            b',' => {
                cursor += 1;
                if cursor == end || !horizontal(bytes[cursor]) {
                    replace(
                        source,
                        cursor,
                        cursor,
                        comma_space(source, cursor, end, closing),
                        edits,
                    );
                }
            },
            b'\r' | b'\n' => {
                let mut line_breaks = String::new();
                let mut count = 0;
                loop {
                    let line_start = cursor;
                    cursor += 1;
                    if bytes[line_start] == b'\r' && cursor < end && bytes[cursor] == b'\n' {
                        cursor += 1;
                    }
                    count += 1;
                    if count <= 2 {
                        line_breaks.push_str(&source[line_start..cursor]);
                    }
                    let mut next = cursor;
                    while next < end && horizontal(bytes[next]) {
                        next += 1;
                    }
                    if next == end || !matches!(bytes[next], b'\r' | b'\n') {
                        break;
                    }
                    cursor = next;
                }
                replace(source, from, cursor, &line_breaks, edits);
            },
            _ => {
                cursor += source[cursor..]
                    .chars()
                    .next()
                    .expect("cursor is in source")
                    .len_utf8();
            },
        }
    }
}

#[cfg(test)]
mod tests;

//! Tag replacement spans reuse native token boundaries and the compiled source map.

use crate::{PromptAnalysis, PromptTokenKind, TextRange};

pub(crate) fn ranges(analysis: &PromptAnalysis) -> Vec<TextRange> {
    let mut ranges = Vec::new();
    for token in &analysis.tokens {
        if token.kind != PromptTokenKind::Text {
            continue;
        }
        let mut position = token.from;
        for tag in token.text.split_inclusive([',', '\r', '\n']) {
            let content = tag.trim_end_matches([',', '\r', '\n']);
            let leading = content.len() - content.trim_start().len();
            let from = position + utf16_len(&content[..leading]);
            let to = if content.trim().is_empty() {
                from
            } else {
                position + utf16_len(content.trim_end())
            };
            if from <= to {
                ranges.push(TextRange { from, to });
            }
            position += utf16_len(tag);
        }
        if token.text.ends_with([',', '\r', '\n']) {
            ranges.push(TextRange {
                from: token.to,
                to: token.to,
            });
        }
    }
    ranges
}

fn utf16_len(text: &str) -> u32 { u32::try_from(text.encode_utf16().count()).unwrap_or(u32::MAX) }

#[cfg(test)]
mod tests;

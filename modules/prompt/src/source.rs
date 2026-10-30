//! Comment scanning preserves native escapes and maps effective UTF-16 ranges to editable text.

use novelai_bridge_prompt::{PromptAnalysis, PromptLexicalState, PromptSyntaxProfile};
use serde::{Deserialize, Serialize};

use crate::{SourceDiagnostic, SourceDiagnosticCode, TextRange};

/// A copied source run. Omitted comments and nib escape prefixes have no output coordinates.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct SourceSegment {
    pub source: TextRange,
    pub output: TextRange,
}

/// Compilation stays usable while editing an unfinished comment; submission checks diagnostics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledPrompt {
    pub text: String,
    pub source_map: Vec<SourceSegment>,
    pub comments: Vec<TextRange>,
    pub diagnostics: Vec<SourceDiagnostic>,
}

impl CompiledPrompt {
    pub(crate) fn native(text: &str) -> Self {
        let length = utf16_len(text);
        Self {
            text: text.to_owned(),
            source_map: vec![SourceSegment {
                source: TextRange {
                    from: 0,
                    to: length,
                },
                output: TextRange {
                    from: 0,
                    to: length,
                },
            }],
            comments: Vec::new(),
            diagnostics: Vec::new(),
        }
    }

    /// Splits a range around removed comments rather than highlighting the comment as NAI text.
    #[must_use]
    pub fn source_ranges(&self, range: TextRange) -> Vec<TextRange> {
        self.overlapping(range)
            .iter()
            .filter_map(|segment| {
                let from = range.from.max(segment.output.from);
                let to = range.to.min(segment.output.to);
                (from < to).then(|| TextRange {
                    from: segment.source.from + from - segment.output.from,
                    to: segment.source.from + to - segment.output.from,
                })
            })
            .collect()
    }

    fn overlapping(&self, range: TextRange) -> &[SourceSegment] {
        let from = self
            .source_map
            .partition_point(|segment| segment.output.to <= range.from);
        let to = self
            .source_map
            .partition_point(|segment| segment.output.from < range.to);
        &self.source_map[from..to.max(from)]
    }

    fn trim(&mut self) {
        let start = utf16_len(self.text.trim_end()) - utf16_len(self.text.trim());
        let end = start + utf16_len(self.text.trim());
        self.source_map = self
            .overlapping(TextRange {
                from: start,
                to: end,
            })
            .iter()
            .filter_map(|segment| {
                let from = segment.output.from.max(start);
                let to = segment.output.to.min(end);
                (from < to).then(|| SourceSegment {
                    source: TextRange {
                        from: segment.source.from + from - segment.output.from,
                        to: segment.source.from + to - segment.output.from,
                    },
                    output: TextRange {
                        from: from - start,
                        to: to - start,
                    },
                })
            })
            .collect();
        self.text = self.text.trim().to_owned();
    }

    fn map_token(
        &self,
        token: &novelai_bridge_prompt::PromptToken,
    ) -> Vec<novelai_bridge_prompt::PromptToken> {
        let mut boundaries = token
            .text
            .char_indices()
            .scan(0u32, |offset, (byte, ch)| {
                let start = *offset;
                *offset +=
                    u32::try_from(ch.len_utf16()).expect("a scalar uses one or two UTF-16 units");
                Some((start, byte))
            })
            .collect::<Vec<_>>();
        boundaries.push((token.to - token.from, token.text.len()));
        self.overlapping(TextRange {
            from: token.from,
            to: token.to,
        })
        .iter()
        .filter_map(|segment| {
            let from = token.from.max(segment.output.from);
            let to = token.to.min(segment.output.to);
            if from >= to {
                return None;
            }
            let start = boundaries.partition_point(|(offset, _)| *offset < from - token.from);
            let end = boundaries.partition_point(|(offset, _)| *offset < to - token.from);
            Some(novelai_bridge_prompt::PromptToken {
                text: token.text[boundaries[start].1..boundaries[end].1].to_owned(),
                from: segment.source.from + from - segment.output.from,
                to: segment.source.from + to - segment.output.from,
                kind: token.kind,
                value: token.value,
            })
        })
        .collect()
    }

    /// Maps SDK tokens, weight spans and diagnostics using one shared UTF-16 source map.
    #[must_use]
    pub fn map_analysis(&self, analysis: PromptAnalysis) -> PromptAnalysis {
        let tokens = analysis
            .tokens
            .iter()
            .flat_map(|token| self.map_token(token))
            .collect();
        let spans = analysis
            .spans
            .into_iter()
            .flat_map(|span| {
                self.source_ranges(TextRange {
                    from: span.from,
                    to: span.to,
                })
                .into_iter()
                .map(move |range| {
                    let mut span = span.clone();
                    span.from = range.from;
                    span.to = range.to;
                    span
                })
            })
            .collect();
        let diagnostics = analysis
            .diagnostics
            .into_iter()
            .map(|mut diagnostic| {
                let ranges = self.source_ranges(TextRange {
                    from: diagnostic.from,
                    to: diagnostic.to,
                });
                if let (Some(first), Some(last)) = (ranges.first(), ranges.last()) {
                    diagnostic.from = first.from;
                    diagnostic.to = last.to;
                } else {
                    // SDK diagnostics may point at EOF instead of covering a character.
                    let index = self
                        .source_map
                        .partition_point(|segment| segment.output.to < diagnostic.from);
                    let boundary = self
                        .source_map
                        .get(index)
                        .or_else(|| self.source_map.last());
                    if let Some(segment) = boundary {
                        diagnostic.from = segment.source.from
                            + diagnostic
                                .from
                                .saturating_sub(segment.output.from)
                                .min(segment.source.to - segment.source.from);
                        diagnostic.to = diagnostic.from;
                    }
                }
                diagnostic
            })
            .collect();
        PromptAnalysis {
            tokens,
            spans,
            diagnostics,
        }
    }
}

/// Compiles and trims each source, retaining locations in the joined editable text.
/// Native rendering/randomizer state continues across sources; nib comments cannot cross them.
#[must_use]
pub fn compile_fragments<'a>(
    sources: impl IntoIterator<Item = &'a str>,
    profile: PromptSyntaxProfile,
) -> CompiledPrompt {
    let mut result = CompiledPrompt {
        text: String::new(),
        source_map: Vec::new(),
        comments: Vec::new(),
        diagnostics: Vec::new(),
    };
    let mut source_offset = 0;
    let mut output_offset = 0;
    let mut state = PromptLexicalState::default();
    for (index, source) in sources.into_iter().enumerate() {
        if index > 0 {
            let previous = result.text.chars().next_back();
            append(&mut result, "\n", source_offset, &mut output_offset);
            state.advance("\n", previous, profile);
            source_offset += 1;
        }
        let mut compiled =
            compile_with_state(source, profile, &mut state, (index > 0).then_some('\n'));
        compiled.trim();
        for mut segment in compiled.source_map {
            segment.source.from += source_offset;
            segment.source.to += source_offset;
            segment.output.from += output_offset;
            segment.output.to += output_offset;
            result.source_map.push(segment);
        }
        result
            .comments
            .extend(compiled.comments.into_iter().map(|mut range| {
                range.from += source_offset;
                range.to += source_offset;
                range
            }));
        result
            .diagnostics
            .extend(compiled.diagnostics.into_iter().map(|mut diagnostic| {
                diagnostic.from += source_offset;
                diagnostic.to += source_offset;
                diagnostic
            }));
        source_offset += utf16_len(source);
        output_offset += utf16_len(&compiled.text);
        result.text.push_str(&compiled.text);
    }
    result
}

fn utf16_len(text: &str) -> u32 { u32::try_from(text.encode_utf16().count()).unwrap_or(u32::MAX) }

fn append(result: &mut CompiledPrompt, text: &str, source_from: u32, output: &mut u32) {
    let length = utf16_len(text);
    if length == 0 {
        return;
    }
    result.text.push_str(text);
    if let Some(last) = result.source_map.last_mut()
        && last.source.to == source_from
        && last.output.to == *output
    {
        last.source.to += length;
        last.output.to += length;
    } else {
        result.source_map.push(SourceSegment {
            source: TextRange {
                from: source_from,
                to: source_from + length,
            },
            output: TextRange {
                from: *output,
                to: *output + length,
            },
        });
    }
    *output += length;
}

/// Removes nib comments independently for one editable source fragment.
/// Ordinary URLs and NAI escapes survive. Quotation marks do not introduce string syntax.
#[must_use]
pub fn compile(source: &str, profile: PromptSyntaxProfile) -> CompiledPrompt {
    compile_with_state(source, profile, &mut PromptLexicalState::default(), None)
}

fn compile_with_state(
    source: &str,
    profile: PromptSyntaxProfile,
    state: &mut PromptLexicalState,
    mut previous: Option<char>,
) -> CompiledPrompt {
    let mut result = CompiledPrompt {
        text: String::new(),
        source_map: Vec::new(),
        comments: Vec::new(),
        diagnostics: Vec::new(),
    };
    let mut byte = 0;
    let mut source_offset = 0;
    let mut output = 0;
    while byte < source.len() {
        let rest = &source[byte..];
        let mut candidate = *state;
        let consumed = candidate.advance(rest, previous, profile);
        // nib only consumes a backslash immediately before its own comment introducers.
        // Other NAI escapes stay intact, and an escaped native marker cannot start rendering.
        if rest.starts_with('\\') {
            let slashes = rest.bytes().take_while(|byte| *byte == b'\\').count();
            if (!state.rendering() || state.uncertain_rendering())
                && (rest[slashes..].starts_with("//") || rest[slashes..].starts_with("/*"))
            {
                let prefix_length = utf16_len(&rest[..slashes]);
                append(
                    &mut result,
                    &rest[..slashes - 1],
                    source_offset,
                    &mut output,
                );
                append(
                    &mut result,
                    &rest[slashes..slashes + 2],
                    source_offset + prefix_length,
                    &mut output,
                );
                byte += slashes + 2;
                source_offset += prefix_length + 2;
                previous = rest[slashes..slashes + 2].chars().last();
                continue;
            }
        }
        let line = rest.starts_with("//") && previous.is_none_or(char::is_whitespace);
        let block = rest.starts_with("/*");
        if candidate.uncertain_rendering() && (line || block) {
            result.diagnostics.push(SourceDiagnostic {
                from: source_offset, to: source_offset + 2,
                code: SourceDiagnosticCode::AmbiguousCommentContext,
                message: "Comment or rendered text depends on the random alternative; escape this marker or move the comment to an unambiguous position.".to_owned(),
            });
        }
        if !candidate.rendering() && (line || block) {
            let end = if line {
                rest.find(['\r', '\n']).unwrap_or(rest.len())
            } else if let Some(end) = rest[2..].find("*/") {
                end + 4
            } else {
                result.diagnostics.push(SourceDiagnostic {
                    from: source_offset,
                    to: source_offset + utf16_len(rest),
                    code: SourceDiagnosticCode::UnclosedBlockComment,
                    message: "Block comment is not closed.".to_owned(),
                });
                rest.len()
            };
            let comment = &rest[..end];
            let length = utf16_len(comment);
            result.comments.push(TextRange {
                from: source_offset,
                to: source_offset + length,
            });
            // A removed block must not join two distinct NAI words. Preserve line structure too.
            if block {
                result.text.push(' ');
                output += 1;
                let mut offset = source_offset;
                for ch in comment.chars() {
                    if matches!(ch, '\r' | '\n') {
                        append(&mut result, &ch.to_string(), offset, &mut output);
                    }
                    offset += u32::try_from(ch.len_utf16())
                        .expect("a scalar uses one or two UTF-16 units");
                }
            }
            previous = result.text.chars().last();
            byte += end;
            source_offset += length;
            continue;
        }
        append(&mut result, &rest[..consumed], source_offset, &mut output);
        byte += consumed;
        source_offset += utf16_len(&rest[..consumed]);
        previous = rest[..consumed].chars().next_back();
        *state = candidate;
    }
    result
}

/// Encodes native NAI text for editable nib source without losing literal comment markers.
#[must_use]
pub fn native_to_source(text: &str, profile: PromptSyntaxProfile) -> String {
    let mut source = String::with_capacity(text.len());
    let mut position = 0;
    let mut previous = None;
    let mut state = PromptLexicalState::default();
    while position < text.len() {
        let rest = &text[position..];
        let mut candidate = state;
        let consumed = candidate.advance(rest, previous, profile);
        if (!candidate.rendering() || candidate.uncertain_rendering())
            && (rest.starts_with("//") || rest.starts_with("/*"))
        {
            source.push('\\');
            source.push_str(&rest[..2]);
            previous = rest[..2].chars().last();
            position += 2;
            continue;
        }
        if rest.starts_with('\\') {
            let slashes = rest.bytes().take_while(|byte| *byte == b'\\').count();
            if (!state.rendering() || state.uncertain_rendering())
                && (rest[slashes..].starts_with("//") || rest[slashes..].starts_with("/*"))
            {
                source.push_str(&rest[..slashes]);
                position += slashes;
                previous = Some('\\');
                continue;
            }
        }
        source.push_str(&rest[..consumed]);
        position += consumed;
        previous = rest[..consumed].chars().next_back();
        state = candidate;
    }
    source
}

#[cfg(test)]
mod tests;

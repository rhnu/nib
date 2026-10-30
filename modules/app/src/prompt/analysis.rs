//! Source comments compile before native analysis; SDK weights span the complete composition.

use nib_prompt::{PromptDocument, PromptSyntaxProfile, compile_fragments};
use novelai_bridge::GenerationMode;
use serde::{Deserialize, Serialize};

use super::{PromptScope, ResolvedDraft, ResolvedFragment};

/// Associates a UTF-16 range in the joined editable source with its original fragment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PromptSourceLocation {
    pub from: u32,
    pub to: u32,
    pub fragment_index: usize,
}

/// One target's source analysis includes both native advisories and blocking nib errors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct ResolvedPromptAnalysis {
    pub scope: PromptScope,
    pub character_id: Option<String>,
    pub document: PromptDocument,
    pub sources: Vec<PromptSourceLocation>,
}

fn target(
    fragments: &[ResolvedFragment],
    scope: PromptScope,
    character_id: Option<&str>,
    profile: PromptSyntaxProfile,
) -> ResolvedPromptAnalysis {
    let selected = fragments
        .iter()
        .enumerate()
        .filter(|(_, fragment)| fragment.scope == scope)
        .collect::<Vec<_>>();
    let mut offset = 0;
    let sources = selected
        .iter()
        .enumerate()
        .map(|(index, (fragment_index, fragment))| {
            if index > 0 {
                offset += 1;
            }
            let from = offset;
            offset += u32::try_from(fragment.text.encode_utf16().count()).unwrap_or(u32::MAX);
            PromptSourceLocation {
                from,
                to: offset,
                fragment_index: *fragment_index,
            }
        })
        .collect();
    let compiled = compile_fragments(
        selected.iter().map(|(_, fragment)| fragment.text.as_str()),
        profile,
    );
    ResolvedPromptAnalysis {
        scope,
        character_id: character_id.map(str::to_owned),
        document: PromptDocument::from_compiled(compiled, profile),
        sources,
    }
}

impl ResolvedDraft {
    /// Rebuilds display analysis from editable sources, without rewriting frozen native values.
    pub(crate) fn analyze_sources(&mut self) {
        let mode = if matches!(
            self.inputs.operation,
            crate::session::CreationOperation::Inpainting { .. }
        ) {
            GenerationMode::Inpainting
        } else {
            GenerationMode::TextToImage
        };
        let model = self.settings.model.descriptor().effective_model_for(mode);
        let profile = model.descriptor().prompt().syntax;
        self.prompt_analysis = [PromptScope::Positive, PromptScope::Negative]
            .into_iter()
            .map(|scope| target(&self.fragments, scope, None, profile))
            .collect();
        for character in &self.characters {
            self.prompt_analysis.extend(
                [PromptScope::Positive, PromptScope::Negative]
                    .into_iter()
                    .map(|scope| target(&character.fragments, scope, Some(&character.id), profile)),
            );
        }
    }

    /// Only fresh resource resolution compiles source text into request fields.
    pub(crate) fn compile_sources(&mut self) {
        self.analyze_sources();
        for analysis in &self.prompt_analysis {
            let target = if let Some(id) = &analysis.character_id {
                let Some(character) = self
                    .characters
                    .iter_mut()
                    .find(|character| &character.id == id)
                else {
                    continue;
                };
                match analysis.scope {
                    PromptScope::Positive => &mut character.positive,
                    PromptScope::Negative => &mut character.negative,
                }
            } else {
                match analysis.scope {
                    PromptScope::Positive => &mut self.positive,
                    PromptScope::Negative => &mut self.negative,
                }
            };
            target.clone_from(&analysis.document.text);
        }
    }
}

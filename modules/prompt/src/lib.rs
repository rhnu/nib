//! Shared nib source comments and source locations around the SDK's native prompt analysis.

mod source;
pub use novelai_bridge_prompt::*;
use serde::{Deserialize, Serialize};
pub use source::{CompiledPrompt, SourceSegment, compile, compile_fragments, native_to_source};

/// UTF-16 coordinates used by the browser and the SDK prompt analyzer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct TextRange {
    pub from: u32,
    pub to: u32,
}

/// Native values from frozen requests and metadata never pass through comment expansion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum PromptContext {
    Editable,
    Native,
}

/// A nib source failure is distinct from advisory SDK syntax diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub enum SourceDiagnosticCode {
    UnclosedBlockComment,
    AmbiguousCommentContext,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct SourceDiagnostic {
    pub from: u32,
    pub to: u32,
    pub code: SourceDiagnosticCode,
    pub message: String,
}

/// Effective NAI text plus analysis located in the original editable source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "typegen", derive(ts_rs::TS))]
pub struct PromptDocument {
    pub text: String,
    pub source_map: Vec<SourceSegment>,
    pub comments: Vec<TextRange>,
    pub source_diagnostics: Vec<SourceDiagnostic>,
    pub analysis: PromptAnalysis,
    pub valid: bool,
}

impl PromptDocument {
    /// Analyzes one compiled composition; comment expansion has already happened per source.
    #[must_use]
    pub fn from_compiled(compiled: CompiledPrompt, profile: PromptSyntaxProfile) -> Self {
        let analysis = compiled.map_analysis(analyze_prompt(&compiled.text, profile));
        Self {
            valid: compiled.diagnostics.is_empty(),
            text: compiled.text,
            source_map: compiled.source_map,
            comments: compiled.comments,
            source_diagnostics: compiled.diagnostics,
            analysis,
        }
    }
}

/// Analyze source or already-native NAI text without depending on transport or tokenizers.
#[must_use]
pub fn analyze(text: &str, profile: PromptSyntaxProfile, context: PromptContext) -> PromptDocument {
    let compiled = match context {
        PromptContext::Editable => compile(text, profile),
        PromptContext::Native => CompiledPrompt::native(text),
    };
    PromptDocument::from_compiled(compiled, profile)
}

#[cfg(feature = "wasm")]
mod wasm {
    use serde::Serialize as _;
    use wasm_bindgen::prelude::*;

    /// The browser calls the same Rust analysis used by native composition.
    #[wasm_bindgen(js_name = analyze)]
    pub fn analyze_wasm(
        text: &str,
        profile: JsValue,
        context: JsValue,
    ) -> Result<JsValue, JsValue> {
        let profile = serde_wasm_bindgen::from_value(profile)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let context = serde_wasm_bindgen::from_value(context)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        // Keep Option::None and object shapes identical to the native JSON/TypeScript contract.
        super::analyze(text, profile, context)
            .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen(js_name = nativeToSource)]
    pub fn native_to_source_wasm(text: &str, profile: JsValue) -> Result<String, JsValue> {
        let profile = serde_wasm_bindgen::from_value(profile)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(super::native_to_source(text, profile))
    }
}

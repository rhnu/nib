import { invokeHost } from "@/shared/host/invoke";
import type { PromptSyntaxProfile } from "@/bindings/prompt";
import type {
  Draft,
  FramingPolicy,
  PresetInstance,
  PromptNode,
  DraftAnalysis,
  TokenInspection,
} from "@/bindings/workbench";

export const promptApi = {
  syntax: (model?: string) => invokeHost<PromptSyntaxProfile>("get_prompt_syntax", { model }),
  resolve: (draft: Draft, includeQuote = false) =>
    invokeHost<DraftAnalysis>("resolve_draft", { draft, includeQuote }),
  expandChunk: (node: PromptNode) => invokeHost<PromptNode>("expand_chunk", { node }),
  expandPreset: (instance: PresetInstance) =>
    invokeHost<PresetInstance>("expand_preset", { instance }),
  inspectTokens: (model: string, text: string, framing: FramingPolicy) =>
    invokeHost<TokenInspection>("inspect_tokens", { model, text, framing }),
};

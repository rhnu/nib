import { invokeHost } from "@/shared/host/invoke";
import type {
  Draft,
  FramingPolicy,
  PresetInstance,
  PromptNode,
  DraftAnalysis,
  TokenInspection,
} from "@/bindings/workbench";
export const promptApi = {
  resolve: (draft: Draft) => invokeHost<DraftAnalysis>("resolve_draft", { draft }),
  expandChunk: (node: PromptNode) => invokeHost<PromptNode>("expand_chunk", { node }),
  expandPreset: (instance: PresetInstance) =>
    invokeHost<PresetInstance>("expand_preset", { instance }),
  inspectTokens: (model: string, text: string, framing: FramingPolicy) =>
    invokeHost<TokenInspection>("inspect_tokens", { model, text, framing }),
};

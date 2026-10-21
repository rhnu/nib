import { invokeHost } from "../../shared/host/invoke";
import type { Draft, PresetInstance, PromptNode, ResolvedDraft } from "../../bindings/workbench";
export const promptApi = {
  resolve: (draft: Draft) => invokeHost<ResolvedDraft>("resolve_draft", { draft }),
  expandChunk: (node: PromptNode) => invokeHost<PromptNode>("expand_chunk", { node }),
  expandPreset: (instance: PresetInstance) =>
    invokeHost<PresetInstance>("expand_preset", { instance }),
};

import { invoke } from "@tauri-apps/api/core";
import type {
  Draft,
  PresetInstance,
  PromptNode,
  Resource,
  ResourceQuery,
  ResourceSummary,
  ResolvedDraft,
  WorkspaceSnapshot,
} from "./bindings/workbench";

export const api = {
  workspace: () => invoke<WorkspaceSnapshot>("get_workspace"),
  search: (query: ResourceQuery) => invoke<ResourceSummary[]>("search_resources", { query }),
  resource: (id: string) => invoke<Resource>("get_resource", { id }),
  saveResource: (resource: Resource) => invoke<Resource>("save_resource", { resource }),
  deleteResource: (id: string, revision: number) =>
    invoke<void>("delete_resource", { id, revision }),
  saveDraft: (draft: Draft) => invoke<Draft>("save_draft", { draft }),
  resolve: (draft: Draft) => invoke<ResolvedDraft>("resolve_draft", { draft }),
  expandChunk: (node: PromptNode) => invoke<PromptNode>("expand_chunk", { node }),
  expandPreset: (instance: PresetInstance) => invoke<PresetInstance>("expand_preset", { instance }),
};

export function errorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return error.message;
  return typeof error === "string" ? error : "操作失败，请重试。";
}

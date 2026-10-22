import { invokeHost } from "../../shared/host/invoke";
import type {
  Draft,
  GenerationSettings,
  ModelCapabilities,
  WorkspaceSnapshot,
} from "../../bindings/workbench";
export const workbenchApi = {
  workspace: () => invokeHost<WorkspaceSnapshot>("get_workspace"),
  saveDraft: (draft: Draft) => invokeHost<Draft>("save_draft", { draft }),
  capabilities: (draft: Draft) =>
    invokeHost<ModelCapabilities | null>("get_model_capabilities", { draft }),
  modelCapabilities: (model?: string, settings?: GenerationSettings | null) =>
    invokeHost<ModelCapabilities>("get_model_defaults_capabilities", {
      model: model ?? null,
      settings: settings ?? null,
    }),
};

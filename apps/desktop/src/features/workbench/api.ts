import { invokeHost } from "../../shared/host/invoke";
import type { Draft, WorkspaceSnapshot } from "../../bindings/workbench";
export const workbenchApi = {
  workspace: () => invokeHost<WorkspaceSnapshot>("get_workspace"),
  saveDraft: (draft: Draft) => invokeHost<Draft>("save_draft", { draft }),
};

import { invokeHost } from "../../shared/host/invoke";
import type { Draft, DraftSaveReceipt, WorkspaceSnapshot } from "../../bindings/workbench";
export const workbenchApi = {
  workspace: () => invokeHost<WorkspaceSnapshot>("get_workspace"),
  saveDraft: (draft: Draft) => invokeHost<DraftSaveReceipt>("save_draft", { draft }),
};

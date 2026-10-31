import { invokeHost } from "@/shared/host/invoke";
import type { Draft, DraftSnapshot, WorkspaceSnapshot } from "@/bindings/workbench";

export const workbenchApi = {
  workspace: () => invokeHost<WorkspaceSnapshot>("get_workspace"),
  draftSnapshot: () => invokeHost<DraftSnapshot>("get_draft_snapshot"),
  saveDraft: (draft: Draft, epoch: string) =>
    invokeHost<DraftSnapshot>("save_draft", { draft, epoch }),
};

/** Carry the backend edit epoch across serialized saves without changing UI edit versions. */
export class DraftPersistence {
  private epoch: string;

  constructor(epoch: string) {
    this.epoch = epoch;
  }

  readEpoch() {
    return this.epoch;
  }

  accept(snapshot: DraftSnapshot) {
    this.epoch = snapshot.epoch;
  }

  save = async (draft: Draft) => {
    this.accept(await workbenchApi.saveDraft(draft, this.epoch));
  };
}

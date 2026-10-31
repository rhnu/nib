import { deferMessage, t, MessageError } from "@/shared/i18n";
import { produce, type Draft } from "immer";
import { createStore } from "zustand/vanilla";

export type WriteState<T> = { value: T | null; dirty: boolean; saving: boolean; error: unknown };

/** Serialize saves while preserving edits made in flight. */
export class DraftWriter<T> {
  readonly store = createStore<WriteState<T>>(() => ({
    value: null,
    dirty: false,
    saving: false,
    error: null,
  }));

  private version = 0;

  private savedVersion = 0;

  private pending: Promise<void> | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;

  private editingLocked = false;

  private write: (value: T) => Promise<void>;

  constructor(write: (value: T) => Promise<void>) {
    this.write = write;
  }

  subscribe = this.store.subscribe;

  getSnapshot = this.store.getState;

  private publish(next: WriteState<T>) {
    this.store.setState(next, true);
  }

  replace(value: T) {
    if (this.getSnapshot().dirty || this.pending)
      throw new MessageError(deferMessage(() => t("workbench.pendingDraftChanges")));
    this.version = 0;
    this.savedVersion = 0;
    this.publish({ value, dirty: false, saving: false, error: null });
  }

  edit(value: T) {
    if (this.editingLocked) throw new MessageError(deferMessage(() => t("agent.editingLocked")));
    const state = this.getSnapshot();
    if (!state.value) throw new MessageError(deferMessage(() => t("workbench.draftNotLoaded")));
    this.version++;
    this.publish({
      ...state,
      value,
      dirty: true,
      error: null,
    });
    this.clearTimer();
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 250);
  }

  /** Stop delayed UI callbacks from creating edits while an external writer owns the draft. */
  setEditingLocked(locked: boolean) {
    this.editingLocked = locked;
  }

  canEdit = () => !this.editingLocked;

  /** Apply a domain edit to the current draft while preserving unchanged branches. */
  update(recipe: (draft: Draft<T>) => void) {
    const value = this.getSnapshot().value;
    if (!value) throw new MessageError(deferMessage(() => t("workbench.draftNotLoaded")));
    const next = produce(value, recipe);
    if (next !== value) this.edit(next);
  }

  flush(): Promise<void> {
    this.clearTimer();
    if (this.pending) return this.pending;
    if (!this.getSnapshot().dirty) return Promise.resolve();
    // Start in a microtask so pending is installed before a synchronous failure settles.
    this.pending = Promise.resolve().then(async () => {
      this.publish({ ...this.getSnapshot(), saving: true, error: null });
      try {
        while (this.savedVersion !== this.version && this.getSnapshot().value) {
          const version = this.version;
          await this.write(this.getSnapshot().value!);
          this.savedVersion = version;
          const state = this.getSnapshot();
          this.publish({
            ...state,
            dirty: version !== this.version,
          });
        }
        this.publish({ ...this.getSnapshot(), saving: false });
      } catch (error) {
        this.publish({ ...this.getSnapshot(), saving: false, error });
        throw error;
      } finally {
        this.pending = null;
      }
    });
    return this.pending;
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

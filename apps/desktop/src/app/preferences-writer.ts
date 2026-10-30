import type { ApplicationPreferences } from "@/bindings/settings";
import { createStore } from "zustand/vanilla";

export type PreferenceState = {
  value: ApplicationPreferences | null;
  dirty: boolean;
  saving: boolean;
  error: unknown;
};

/** Preserve newer edits while writing preferences in the order they were made. */
export class PreferencesWriter {
  readonly store = createStore<PreferenceState>(() => ({
    value: null,
    dirty: false,
    saving: false,
    error: null,
  }));

  private version = 0;

  private pending: Promise<void> | null = null;

  private write: (value: ApplicationPreferences) => Promise<ApplicationPreferences>;

  private saved: ApplicationPreferences | null = null;

  private onSaved?: (
    value: ApplicationPreferences,
    previous: ApplicationPreferences | null,
  ) => void;

  constructor(
    write: (value: ApplicationPreferences) => Promise<ApplicationPreferences>,
    onSaved?: (value: ApplicationPreferences, previous: ApplicationPreferences | null) => void,
  ) {
    this.write = write;
    this.onSaved = onSaved;
  }

  subscribe = this.store.subscribe;

  getSnapshot = this.store.getState;

  getSavedSnapshot = () => this.saved;

  private publish(state: PreferenceState) {
    this.store.setState(state, true);
  }

  initialize(value: ApplicationPreferences) {
    if (this.getSnapshot().value) throw new Error("应用设置已经加载。");
    this.saved = value;
    this.publish({ value, dirty: false, saving: false, error: null });
  }

  edit(value: ApplicationPreferences) {
    const state = this.getSnapshot();
    if (!state.value) throw new Error("应用设置尚未加载。");
    this.version++;
    this.publish({ ...state, value, dirty: true, error: null });
    void this.flush().catch(() => {});
  }

  flush = (): Promise<void> => {
    if (this.pending) return this.pending;
    if (!this.getSnapshot().dirty) return Promise.resolve();
    this.pending = Promise.resolve().then(async () => {
      this.publish({ ...this.getSnapshot(), saving: true, error: null });
      try {
        while (this.getSnapshot().dirty && this.getSnapshot().value) {
          const version = this.version;
          const saved = await this.write(this.getSnapshot().value!);
          const previous = this.saved;
          this.saved = saved;
          this.onSaved?.(saved, previous);
          const state = this.getSnapshot();
          this.publish({
            ...state,
            value: version === this.version ? saved : state.value,
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
  };
}

import type { ApplicationPreferences } from "@/bindings/settings";

type PreferenceState = {
  value: ApplicationPreferences | null;
  dirty: boolean;
  saving: boolean;
  error: unknown;
};

/** Preserve newer edits while writing preferences in the order they were made. */
export class PreferencesWriter {
  private state: PreferenceState = { value: null, dirty: false, saving: false, error: null };
  private version = 0;
  private pending: Promise<void> | null = null;
  private listeners = new Set<() => void>();
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

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  getSavedSnapshot = () => this.saved;
  private publish(state: PreferenceState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  initialize(value: ApplicationPreferences) {
    if (this.state.value) throw new Error("应用设置已经加载。");
    this.saved = value;
    this.publish({ value, dirty: false, saving: false, error: null });
  }
  edit(value: ApplicationPreferences) {
    if (!this.state.value) throw new Error("应用设置尚未加载。");
    this.version++;
    this.publish({ ...this.state, value, dirty: true, error: null });
    void this.flush().catch(() => {});
  }
  flush = (): Promise<void> => {
    if (this.pending) return this.pending;
    if (!this.state.dirty) return Promise.resolve();
    this.pending = Promise.resolve().then(async () => {
      this.publish({ ...this.state, saving: true, error: null });
      try {
        while (this.state.dirty && this.state.value) {
          const version = this.version;
          const saved = await this.write(this.state.value);
          const previous = this.saved;
          this.saved = saved;
          this.onSaved?.(saved, previous);
          this.publish({
            ...this.state,
            value: version === this.version ? saved : this.state.value,
            dirty: version !== this.version,
          });
        }
        this.publish({ ...this.state, saving: false });
      } catch (error) {
        this.publish({ ...this.state, saving: false, error });
        throw error;
      } finally {
        this.pending = null;
      }
    });
    return this.pending;
  };
}

export type WriteState<T> = { value: T | null; dirty: boolean; saving: boolean; error: unknown };

/** Serialize writes and apply returned revisions without replacing edits made in flight. */
export class DraftWriter<T extends { revision: number }> {
  private state: WriteState<T> = { value: null, dirty: false, saving: false, error: null };
  private version = 0;
  private savedVersion = 0;
  private pending: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private write: (value: T) => Promise<T>;

  constructor(write: (value: T) => Promise<T>) {
    this.write = write;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(next: WriteState<T>) {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
  replace(value: T) {
    if (this.state.dirty || this.pending) throw new Error("当前创作仍有待写入的修改。");
    this.version = 0;
    this.savedVersion = 0;
    this.publish({ value, dirty: false, saving: false, error: null });
  }
  edit(value: T) {
    if (!this.state.value) throw new Error("当前创作尚未加载。");
    this.version++;
    this.publish({ ...this.state, value, dirty: true, error: null });
    this.clearTimer();
    this.timer = setTimeout(() => {
      void this.flush().catch(() => {});
    }, 250);
  }
  flush(): Promise<void> {
    this.clearTimer();
    if (this.pending) return this.pending;
    if (!this.state.dirty) return Promise.resolve();
    // Start in a microtask so pending is installed before a synchronous failure settles.
    this.pending = Promise.resolve().then(async () => {
      this.publish({ ...this.state, saving: true, error: null });
      try {
        while (this.savedVersion !== this.version && this.state.value) {
          const version = this.version;
          const result = await this.write(this.state.value);
          this.savedVersion = version;
          this.publish({
            ...this.state,
            value: { ...this.state.value, revision: result.revision },
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
  }
  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

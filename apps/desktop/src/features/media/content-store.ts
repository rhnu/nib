import { deferMessage, t, MessageError } from "@/shared/i18n";

export type ContentSnapshot = { url: string | null; error: unknown; loading: boolean };

/** Each immutable content variant is shared only while it has mounted consumers. */
export class MediaContentStore {
  private resources = new Map<string, ContentResource>();

  private revoke: (url: string) => void;

  constructor(revoke: (url: string) => void) {
    this.revoke = revoke;
  }

  resource(key: string, load: () => Promise<string>): ContentResource {
    let resource = this.resources.get(key);
    if (!resource) {
      resource = new ContentResource(load, this.revoke, () => {
        if (this.resources.get(key) === resource) this.resources.delete(key);
      });
      this.resources.set(key, resource);
    }
    return resource;
  }
}

class ContentResource {
  private state: ContentSnapshot = { url: null, error: null, loading: true };

  private listeners = new Set<() => void>();

  private started = false;

  private generation = 0;

  private load: () => Promise<string>;

  private revoke: (url: string) => void;

  private remove: () => void;

  constructor(load: () => Promise<string>, revoke: (url: string) => void, remove: () => void) {
    this.load = load;
    this.revoke = revoke;
    this.remove = remove;
  }

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (!this.started) this.retry();
    return () => {
      this.listeners.delete(listener);
      // StrictMode can reconnect the same subscription before this microtask runs.
      queueMicrotask(() => {
        if (this.listeners.size) return;
        this.generation++;
        if (this.state.url) this.revoke(this.state.url);
        this.state = { url: null, error: null, loading: true };
        this.started = false;
        this.remove();
      });
    };
  };

  private publish(state: ContentSnapshot) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }

  retry = () => {
    const generation = ++this.generation;
    this.started = true;
    if (this.state.url) this.revoke(this.state.url);
    this.publish({ url: null, error: null, loading: true });
    void Promise.resolve()
      .then(this.load)
      .then(
        (url) => {
          if (generation !== this.generation) this.revoke(url);
          else this.publish({ url, error: null, loading: false });
        },
        (error: unknown) => {
          if (generation === this.generation) this.publish({ url: null, error, loading: false });
        },
      );
  };

  failed = () => {
    this.generation++;
    if (this.state.url) this.revoke(this.state.url);
    this.publish({
      url: null,
      error: new MessageError(deferMessage(() => t("media.imageDisplayFailed"))),
      loading: false,
    });
  };
}

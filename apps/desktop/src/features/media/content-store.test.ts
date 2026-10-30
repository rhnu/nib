import { describe, expect, it, vi } from "vitest";
import { MediaContentStore } from "./content-store";
import { applyLanguage, errorMessage } from "@/shared/i18n";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("mounted media content", () => {
  it("reformats a retained display failure when the language changes", () => {
    const resource = new MediaContentStore(vi.fn()).resource(
      "original:asset",
      async () => "blob:image",
    );
    resource.failed();
    const snapshot = resource.getSnapshot();
    applyLanguage("en");
    const english = errorMessage(snapshot.error);
    try {
      applyLanguage("zh-CN");
      expect(errorMessage(snapshot.error)).not.toBe(english);
      expect(resource.getSnapshot()).toBe(snapshot);
      expect(snapshot.error).toBeInstanceOf(Error);
    } finally {
      applyLanguage("system");
    }
  });

  it("shares one load for consumers of the same immutable variant", async () => {
    const loaded = deferred<string>();
    const load = vi.fn(() => loaded.promise);
    const revoke = vi.fn();
    const store = new MediaContentStore(revoke);
    const first = store.resource("thumbnail:asset", load);
    const second = store.resource("thumbnail:asset", load);
    expect(second).toBe(first);
    const releaseFirst = first.subscribe(() => {});
    const releaseSecond = second.subscribe(() => {});
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    loaded.resolve("blob:shared");
    await vi.waitFor(() => {
      expect(first.getSnapshot()).toEqual({
        url: "blob:shared",
        error: null,
        loading: false,
      });
      expect(second.getSnapshot().url).toBe("blob:shared");
    });
    releaseFirst();
    releaseSecond();
    await Promise.resolve();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:shared");
  });

  it("keeps a loaded URL alive until its last subscriber releases it", async () => {
    const revoke = vi.fn();
    const store = new MediaContentStore(revoke);
    const resource = store.resource("original:asset", async () => "blob:original");
    const releaseFirst = resource.subscribe(() => {});
    const releaseSecond = resource.subscribe(() => {});
    await vi.waitFor(() => expect(resource.getSnapshot().url).toBe("blob:original"));

    releaseFirst();
    await Promise.resolve();
    expect(revoke).not.toHaveBeenCalled();
    expect(resource.getSnapshot().url).toBe("blob:original");

    releaseSecond();
    await Promise.resolve();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:original");
    expect(store.resource("original:asset", async () => "blob:next")).not.toBe(resource);
  });

  it("releases a late load after every consumer has gone away", async () => {
    const loaded = deferred<string>();
    const revoke = vi.fn();
    const store = new MediaContentStore(revoke);
    const resource = store.resource("original:asset", () => loaded.promise);
    const release = resource.subscribe(() => {});
    await Promise.resolve();
    release();
    await Promise.resolve();
    loaded.resolve("blob:orphan");
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:orphan"));
    expect(resource.getSnapshot().url).toBeNull();
  });

  it("does not let a response from before retry replace the current URL", async () => {
    const oldLoad = deferred<string>();
    const newLoad = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(oldLoad.promise).mockReturnValueOnce(newLoad.promise);
    const revoke = vi.fn();
    const resource = new MediaContentStore(revoke).resource("original:asset", load);
    const release = resource.subscribe(() => {});
    await Promise.resolve();
    resource.retry();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);

    newLoad.resolve("blob:new");
    await vi.waitFor(() => expect(resource.getSnapshot().url).toBe("blob:new"));
    oldLoad.resolve("blob:old");
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:old"));
    expect(resource.getSnapshot().url).toBe("blob:new");
    expect(revoke).not.toHaveBeenCalledWith("blob:new");

    release();
    await Promise.resolve();
    expect(revoke).toHaveBeenCalledWith("blob:new");
  });

  it("reuses the pending load when StrictMode reconnects during the same turn", async () => {
    const loaded = deferred<string>();
    const load = vi.fn(() => loaded.promise);
    const revoke = vi.fn();
    const store = new MediaContentStore(revoke);
    const resource = store.resource("thumbnail:asset", load);
    const releaseFirst = resource.subscribe(() => {});
    releaseFirst();
    const reconnected = store.resource("thumbnail:asset", load);
    const releaseSecond = reconnected.subscribe(() => {});
    await Promise.resolve();
    expect(reconnected).toBe(resource);
    expect(load).toHaveBeenCalledTimes(1);

    loaded.resolve("blob:strict-mode");
    await vi.waitFor(() => expect(reconnected.getSnapshot().url).toBe("blob:strict-mode"));
    expect(revoke).not.toHaveBeenCalled();
    releaseSecond();
    await Promise.resolve();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:strict-mode");
  });
});

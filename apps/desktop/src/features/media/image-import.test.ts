import { describe, expect, it } from "vitest";
import type { MediaAsset } from "../../bindings/media";
import {
  hasPendingWork,
  trackPendingWork,
  waitForPendingWork,
} from "../../shared/host/pending-work";
import { importAndCommitImage } from "./image-import";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const asset: MediaAsset = {
  id: "source",
  kind: "image",
  mimeType: "image/png",
  byteLength: 1,
  width: 1,
  height: 1,
  createdAt: 0,
  source: { kind: "import", name: "source.png" },
  available: true,
};

describe("image import lifecycle", () => {
  it("keeps file reading, import and the final asynchronous commit pending together", async () => {
    const bytes = deferred<ArrayBuffer>();
    const imported = deferred<MediaAsset>();
    const committing = deferred<void>();
    let saved = false;
    const work = importAndCommitImage({
      file: { name: "source.png", arrayBuffer: () => bytes.promise },
      importImage: () => imported.promise,
      commit: async () => {
        await committing.promise;
        saved = true;
      },
      isCurrent: () => true,
    });
    const waiting = waitForPendingWork();
    expect(hasPendingWork()).toBe(true);
    bytes.resolve(new ArrayBuffer(1));
    await Promise.resolve();
    expect(hasPendingWork()).toBe(true);
    imported.resolve(asset);
    await Promise.resolve();
    expect(saved).toBe(false);
    expect(hasPendingWork()).toBe(true);
    committing.resolve();
    await work;
    await waiting;
    expect(saved).toBe(true);
    expect(hasPendingWork()).toBe(false);
  });

  it("supports a nested tracked preparation without waiting for its own import", async () => {
    const preparation = deferred<void>();
    let committed = false;
    const work = importAndCommitImage({
      file: { name: "source.png", arrayBuffer: async () => new ArrayBuffer(1) },
      importImage: async () => asset,
      commit: () =>
        trackPendingWork(
          preparation.promise.then(() => {
            committed = true;
          }),
        ),
      isCurrent: () => true,
    });
    const waiting = waitForPendingWork();
    preparation.resolve();
    await work;
    await waiting;
    expect(committed).toBe(true);
    expect(hasPendingWork()).toBe(false);
  });

  it("does not import a file after the receiving editor has been replaced", async () => {
    const bytes = deferred<ArrayBuffer>();
    let current = true;
    let imported = false;
    const work = importAndCommitImage({
      file: { name: "source.png", arrayBuffer: () => bytes.promise },
      importImage: async () => {
        imported = true;
        return asset;
      },
      commit: () => {
        throw new Error("replaced editor must not receive the image");
      },
      isCurrent: () => current,
    });
    current = false;
    bytes.resolve(new ArrayBuffer(1));
    await work;
    expect(imported).toBe(false);
  });

  it("ignores an import result when its original action has become stale", async () => {
    const imported = deferred<MediaAsset>();
    let current = true;
    let committed = false;
    const work = importAndCommitImage({
      file: { name: "source.png", arrayBuffer: async () => new ArrayBuffer(1) },
      importImage: () => imported.promise,
      commit: () => {
        committed = true;
      },
      isCurrent: () => current,
    });
    await Promise.resolve();
    current = false;
    imported.resolve(asset);
    await work;
    expect(committed).toBe(false);
  });

  it("propagates a failed commit to both the importer and an active close wait", async () => {
    const committing = deferred<void>();
    const failure = new Error("operation preparation failed");
    const work = importAndCommitImage({
      file: { name: "source.png", arrayBuffer: async () => new ArrayBuffer(1) },
      importImage: async () => asset,
      commit: () => committing.promise,
      isCurrent: () => true,
    });
    const workFailed = expect(work).rejects.toBe(failure);
    const closeFailed = expect(waitForPendingWork()).rejects.toBe(failure);
    committing.reject(failure);
    await workFailed;
    await closeFailed;
    expect(hasPendingWork()).toBe(false);
  });
});

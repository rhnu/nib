import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftWriter } from "./draft-writer";

type Document = { revision: number; text: string };
const initial: Document = { revision: 1, text: "original" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("DraftWriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("automatically saves the latest content and parameters after edits settle", async () => {
    const write = vi.fn(async (value: Document & { steps: number }) => ({
      ...value,
      revision: value.revision + 1,
    }));
    const writer = new DraftWriter(write);
    writer.replace({ ...initial, steps: 20 });
    writer.edit({ ...initial, steps: 20, text: "edited" });
    await vi.advanceTimersByTimeAsync(200);
    writer.edit({ ...initial, steps: 28, text: "edited" });
    await vi.advanceTimersByTimeAsync(200);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(50);
    expect(write).toHaveBeenCalledExactlyOnceWith({ ...initial, text: "edited", steps: 28 });
    expect(writer.getSnapshot()).toMatchObject({
      value: { revision: 2, text: "edited", steps: 28 },
      dirty: false,
      error: null,
    });
  });

  it("retains failed automatic saves and resumes automatically on the next edit", async () => {
    const write = vi
      .fn<(value: Document) => Promise<Document>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (value) => ({ ...value, revision: 2 }));
    const writer = new DraftWriter(write);
    writer.replace(initial);
    writer.edit({ ...initial, text: "keep me" });
    await vi.advanceTimersByTimeAsync(250);
    expect(writer.getSnapshot()).toMatchObject({
      value: { revision: 1, text: "keep me" },
      dirty: true,
      saving: false,
      error: expect.any(Error),
    });
    writer.edit({ ...initial, text: "latest" });
    await vi.advanceTimersByTimeAsync(250);
    expect(writer.getSnapshot()).toMatchObject({
      value: { revision: 2, text: "latest" },
      dirty: false,
      error: null,
    });
  });

  it("serializes edits made during a save using the returned revision", async () => {
    const first = deferred<Document>();
    const writes: Document[] = [];
    const writer = new DraftWriter<Document>((value) => {
      writes.push(value);
      return writes.length === 1 ? first.promise : Promise.resolve({ ...value, revision: 3 });
    });
    writer.replace(initial);
    writer.edit({ ...initial, text: "first" });
    const saving = writer.flush();
    expect(writer.flush()).toBe(saving);
    await Promise.resolve();
    writer.edit({ ...initial, text: "latest" });
    first.resolve({ ...initial, revision: 2, text: "first" });
    await saving;
    expect(writes).toEqual([
      { ...initial, text: "first" },
      { ...initial, revision: 2, text: "latest" },
    ]);
    expect(writer.getSnapshot()).toMatchObject({
      value: { revision: 3, text: "latest" },
      dirty: false,
      saving: false,
    });
  });

  it("preserves unsaved edits after failure and retries without changing their revision", async () => {
    const failed = deferred<Document>();
    let attempts = 0;
    const writer = new DraftWriter<Document>((value) =>
      ++attempts === 1 ? failed.promise : Promise.resolve({ ...value, revision: 2 }),
    );
    writer.replace(initial);
    writer.edit({ ...initial, text: "keep me" });
    const saving = writer.flush();
    const assertion = expect(saving).rejects.toThrow("offline");
    failed.reject(new Error("offline"));
    await assertion;
    expect(writer.getSnapshot()).toMatchObject({
      value: { text: "keep me", revision: 1 },
      dirty: true,
      saving: false,
    });
    expect(() => writer.replace(initial)).toThrow();
    await writer.flush();
    expect(writer.getSnapshot()).toMatchObject({
      value: { text: "keep me", revision: 2 },
      dirty: false,
      error: null,
    });
  });
});

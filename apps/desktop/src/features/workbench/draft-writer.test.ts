import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftWriter } from "./draft-writer";

type Document = { text: string };
const initial: Document = { text: "original" };

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
    const write = vi
      .fn<(value: Document & { steps: number }) => Promise<void>>()
      .mockResolvedValue(undefined);
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
      value: { text: "edited", steps: 28 },
      dirty: false,
      error: null,
    });
  });

  it("retains failed automatic saves and resumes automatically on the next edit", async () => {
    const write = vi
      .fn<(value: Document) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const writer = new DraftWriter(write);
    writer.replace(initial);
    writer.edit({ ...initial, text: "keep me" });
    await vi.advanceTimersByTimeAsync(250);
    expect(writer.getSnapshot()).toMatchObject({
      value: { text: "keep me" },
      dirty: true,
      saving: false,
      error: expect.any(Error),
    });
    writer.edit({ ...initial, text: "latest" });
    await vi.advanceTimersByTimeAsync(250);
    expect(writer.getSnapshot()).toMatchObject({
      value: { text: "latest" },
      dirty: false,
      error: null,
    });
  });

  it("serializes saves and preserves edits made while a save is in flight", async () => {
    const first = deferred<void>();
    const writes: Document[] = [];
    const writer = new DraftWriter<Document>((value) => {
      writes.push(value);
      return writes.length === 1 ? first.promise : Promise.resolve();
    });
    writer.replace(initial);
    writer.edit({ ...initial, text: "first" });
    const saving = writer.flush();
    expect(writer.flush()).toBe(saving);
    await Promise.resolve();
    writer.edit({ ...initial, text: "latest" });
    expect(writer.getSnapshot()).toMatchObject({ value: { text: "latest" }, dirty: true });
    first.resolve(undefined);
    await saving;
    expect(writes).toEqual([
      { ...initial, text: "first" },
      { ...initial, text: "latest" },
    ]);
    expect(writer.getSnapshot()).toMatchObject({
      value: { text: "latest" },
      dirty: false,
      saving: false,
    });
  });

  it("applies nested domain updates without mutating the previous draft or persisting no-ops", async () => {
    type Nested = Document & {
      composition: { entries: { text: string }[] };
      model: { id: string };
    };
    const write = vi.fn<(value: Nested) => Promise<void>>().mockResolvedValue(undefined);
    const writer = new DraftWriter(write);
    const original: Nested = {
      ...initial,
      composition: { entries: [{ text: "old" }] },
      model: { id: "model" },
    };
    writer.replace(original);
    writer.update(() => {});
    await writer.flush();
    expect(write).not.toHaveBeenCalled();
    writer.update((draft) => {
      draft.composition.entries[0].text = "new";
      draft.composition.entries.push({ text: "added" });
    });
    expect(original.composition.entries).toEqual([{ text: "old" }]);
    expect(writer.getSnapshot().value?.composition.entries).toEqual([
      { text: "new" },
      { text: "added" },
    ]);
    expect(writer.getSnapshot().value?.model).toBe(original.model);
    await writer.flush();
    expect(writer.getSnapshot()).toMatchObject({ dirty: false });
  });

  it("preserves unsaved edits after failure and retries the latest content", async () => {
    const failed = deferred<void>();
    let attempts = 0;
    const writer = new DraftWriter<Document>(() =>
      ++attempts === 1 ? failed.promise : Promise.resolve(),
    );
    writer.replace(initial);
    writer.edit({ ...initial, text: "keep me" });
    const saving = writer.flush();
    const assertion = expect(saving).rejects.toThrow("offline");
    failed.reject(new Error("offline"));
    await assertion;
    expect(writer.getSnapshot()).toMatchObject({
      value: { text: "keep me" },
      dirty: true,
      saving: false,
    });
    expect(() => writer.replace(initial)).toThrow();
    await writer.flush();
    expect(writer.getSnapshot()).toMatchObject({
      value: { text: "keep me" },
      dirty: false,
      error: null,
    });
  });

  it("rejects late UI edits while another writer owns the draft and resumes from its snapshot", async () => {
    const write = vi.fn<(value: Document) => Promise<void>>().mockResolvedValue(undefined);
    const writer = new DraftWriter(write);
    writer.replace(initial);
    writer.edit({ text: "before takeover" });
    await writer.flush();
    writer.setEditingLocked(true);
    expect(() => writer.edit({ text: "stale callback" })).toThrow();
    writer.replace({ text: "agent edit" });
    expect(writer.getSnapshot()).toMatchObject({ value: { text: "agent edit" }, dirty: false });
    writer.setEditingLocked(false);
    writer.update((draft) => {
      draft.text += " and UI edit";
    });
    await writer.flush();
    expect(write).toHaveBeenLastCalledWith({ text: "agent edit and UI edit" });
    expect(write).toHaveBeenCalledTimes(2);
  });
});

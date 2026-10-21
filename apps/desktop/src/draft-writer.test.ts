import { describe, expect, it } from "vitest";
import { DraftWriter } from "./draft-writer";

type Document = { id: string; revision: number; text: string };
const initial: Document = { id: "draft-a", revision: 1, text: "original" };
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
    expect(() => writer.replace({ ...initial, id: "draft-b" })).toThrow();
    await writer.flush();
    expect(writer.getSnapshot()).toMatchObject({
      value: { text: "keep me", revision: 2 },
      dirty: false,
      error: null,
    });
  });
});

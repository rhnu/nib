import { describe, expect, it } from "vitest";
import { hasPendingWork, trackPendingWork, waitForPendingWork } from "./pending-work";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("pending editable work", () => {
  it("preserves the operation result and clears pending status after completion", async () => {
    const work = deferred<number>();
    const tracked = trackPendingWork(work.promise);
    expect(hasPendingWork()).toBe(true);
    work.resolve(42);
    await expect(tracked).resolves.toBe(42);
    expect(hasPendingWork()).toBe(false);
  });

  it("waits for work added after waiting has started", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const one = trackPendingWork(first.promise);
    let finished = false;
    const waiting = waitForPendingWork().then(() => {
      finished = true;
    });
    const two = trackPendingWork(second.promise);
    first.resolve();
    await one;
    await Promise.resolve();
    expect(finished).toBe(false);
    second.resolve();
    await two;
    await waiting;
    expect(finished).toBe(true);
  });

  it("keeps a result pending until it has also been committed to editable state", async () => {
    const api = deferred<string>();
    const commit = deferred<void>();
    let saved = "";
    const tracked = trackPendingWork(
      (async () => {
        const value = await api.promise;
        await commit.promise;
        saved = value;
      })(),
    );
    const waiting = waitForPendingWork();
    api.resolve("reference");
    await Promise.resolve();
    expect(hasPendingWork()).toBe(true);
    expect(saved).toBe("");
    commit.resolve();
    await tracked;
    await waiting;
    expect(saved).toBe("reference");
  });

  it("observes a newly added failure even when it settles before the initial batch", async () => {
    const first = deferred<void>();
    const late = deferred<void>();
    const one = trackPendingWork(first.promise);
    const waiting = waitForPendingWork();
    const two = trackPendingWork(late.promise);
    const error = new Error("late operation failed");
    late.reject(error);
    await expect(two).rejects.toBe(error);
    first.resolve();
    await one;
    await expect(waiting).rejects.toBe(error);
    expect(hasPendingWork()).toBe(false);
  });

  it("waits for remaining work and rejects instead of allowing a failed close", async () => {
    const failed = deferred<void>();
    const other = deferred<void>();
    const error = new Error("reference construction failed");
    const failure = trackPendingWork(failed.promise);
    const success = trackPendingWork(other.promise);
    const waiting = waitForPendingWork();
    failed.reject(error);
    await expect(failure).rejects.toBe(error);
    expect(hasPendingWork()).toBe(true);
    other.resolve();
    await success;
    await expect(waiting).rejects.toBe(error);
    expect(hasPendingWork()).toBe(false);
  });
});

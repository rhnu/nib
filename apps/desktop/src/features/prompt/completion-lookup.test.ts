import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LexiconMatch, LexiconSearchResult } from "@/bindings/lexicon";
import { lookupCompletions } from "./completion-lookup";

function match(name: string, reason: LexiconMatch["reason"]): LexiconMatch {
  return {
    term: {
      key: name,
      name,
      promptText: name,
      kind: "general",
      translation: null,
      description: null,
      postCount: 0,
      aliases: [],
      groups: [],
      source: "test",
    },
    reason,
    score: 1,
  };
}

function result(matches: LexiconMatch[]): LexiconSearchResult {
  return { generation: "test", matches, semanticAvailable: true };
}

function deferred() {
  let resolve!: (value: LexiconSearchResult) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<LexiconSearchResult>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("completion lookups", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("queries only the newest text after continuous typing pauses", async () => {
    const search = vi.fn(async () => result([]));
    const publish = vi.fn();
    let cancel = lookupCompletions(
      { text: "b", semantic: false, elapsed: 0 },
      search,
      () => true,
      publish,
    );
    await vi.advanceTimersByTimeAsync(100);
    cancel();
    cancel = lookupCompletions(
      { text: "bl", semantic: false, elapsed: 0 },
      search,
      () => true,
      publish,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(search).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(search).toHaveBeenCalledExactlyOnceWith("bl", false);
    cancel();
  });

  it("counts analysis time toward the input pause", async () => {
    const search = vi.fn(async () => result([]));
    lookupCompletions({ text: "blue", semantic: false, elapsed: 180 }, search, () => true, vi.fn());
    await vi.advanceTimersByTimeAsync(19);
    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledOnce();
  });

  it("publishes lexical matches while slow semantic inference is still pending", async () => {
    const semantic = deferred();
    const lexical = match("blue eyes", "name");
    const related = match("green eyes", "related");
    const search = vi.fn((_text: string, useSemantic: boolean) =>
      useSemantic ? semantic.promise : Promise.resolve(result([lexical])),
    );
    const publish = vi.fn();
    lookupCompletions({ text: "eyes", semantic: true, elapsed: 0 }, search, () => true, publish);
    await vi.runAllTimersAsync();
    expect(publish).toHaveBeenCalledExactlyOnceWith([lexical]);
    semantic.resolve(result([lexical, related]));
    await Promise.resolve();
    expect(publish).toHaveBeenLastCalledWith([lexical, related]);
  });

  it("retains the old list when lexical lookup is empty until semantics finishes", async () => {
    const semantic = deferred();
    const publish = vi.fn();
    lookupCompletions(
      { text: "eyes", semantic: true, elapsed: 0 },
      (_text, useSemantic) => (useSemantic ? semantic.promise : Promise.resolve(result([]))),
      () => true,
      publish,
    );
    await vi.runAllTimersAsync();
    expect(publish).not.toHaveBeenCalled();
    semantic.resolve(result([]));
    await Promise.resolve();
    expect(publish).toHaveBeenCalledExactlyOnceWith([]);
  });

  it("keeps lexical ordering when semantics finishes first", async () => {
    const lexical = deferred();
    const name = match("blue eyes", "name");
    const related = match("green eyes", "semantic");
    const publish = vi.fn();
    lookupCompletions(
      { text: "eyes", semantic: true, elapsed: 0 },
      (_text, useSemantic) => (useSemantic ? Promise.resolve(result([related])) : lexical.promise),
      () => true,
      publish,
    );
    await vi.runAllTimersAsync();
    expect(publish).not.toHaveBeenCalled();
    lexical.resolve(result([name]));
    await Promise.resolve();
    expect(publish).toHaveBeenCalledExactlyOnceWith([name, related]);
  });

  it.each(["cancelled", "stale"])("ignores a %s response", async (condition) => {
    const response = deferred();
    const publish = vi.fn();
    let current = true;
    const cancel = lookupCompletions(
      { text: "blue", semantic: false, elapsed: 0 },
      () => response.promise,
      () => current,
      publish,
    );
    await vi.runAllTimersAsync();
    if (condition === "cancelled") cancel();
    else current = false;
    response.resolve(result([match("blue eyes", "name")]));
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
  });

  it("finishes an unsuccessful lookup without blocking editing", async () => {
    const publish = vi.fn();
    lookupCompletions(
      { text: "blue", semantic: false, elapsed: 0 },
      () => Promise.reject(new Error("unavailable")),
      () => true,
      publish,
    );
    await vi.runAllTimersAsync();
    expect(publish).toHaveBeenCalledExactlyOnceWith([]);
  });
});

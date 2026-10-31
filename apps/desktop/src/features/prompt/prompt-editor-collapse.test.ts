import { describe, expect, it } from "vitest";
import { promptBlockCollapsed, promptBlockKey } from "./prompt-editor-collapse";

describe("prompt block collapse state", () => {
  it("uses each node's initial presentation when no saved state exists", () => {
    const state = { collapsedBlocks: {} };
    expect(promptBlockCollapsed(state, promptBlockKey(["positive"], "chunk"), true)).toBe(true);
    expect(promptBlockCollapsed(state, promptBlockKey(["positive"], "text"), false)).toBe(false);
  });

  it("restores explicit expansion of a referenced chunk", () => {
    const key = promptBlockKey(["positive"], "chunk");
    expect(promptBlockCollapsed({ collapsedBlocks: { [key]: false } }, key, true)).toBe(false);
    expect(promptBlockCollapsed({ collapsedBlocks: { [key]: true } }, key, false)).toBe(true);
  });

  it("keeps scopes, preset instances and characters independent", () => {
    const paths = [
      ["positive"],
      ["negative"],
      ["preset", "first", "positive"],
      ["preset", "second", "positive"],
      ["character", "first", "positive"],
      ["character", "second", "positive"],
      ["preset", "first", "character", "first", "positive"],
      ["preset", "second", "character", "first", "positive"],
    ];
    const keys = paths.map((path) => promptBlockKey(path, "shared-node"));
    const state = { collapsedBlocks: { [keys[0]]: false } };
    expect(new Set(keys).size).toBe(paths.length);
    expect(keys.slice(1).every((key) => promptBlockCollapsed(state, key, true))).toBe(true);
  });

  it("keeps path boundaries unambiguous when IDs contain punctuation", () => {
    expect(promptBlockKey(["preset", "a:b", "positive"], 'node:["x"]')).not.toBe(
      promptBlockKey(["preset", "a", "b:positive"], 'node:["x"]'),
    );
  });
});

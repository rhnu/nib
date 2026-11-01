import { describe, expect, it } from "vitest";
import { moveItem } from "./model";

describe("ordered item movement", () => {
  it("moves items up and down by one position", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("moves across multiple positions while retaining the other items' order", () => {
    const items = ["a", "b", "c", "d"];
    expect(moveItem(items, 0, 3)).toEqual(["b", "c", "d", "a"]);
    expect(moveItem(items, 3, -3)).toEqual(["d", "a", "b", "c"]);
    expect(items).toEqual(["a", "b", "c", "d"]);
  });

  it("retains the list for unchanged or invalid positions", () => {
    const items = ["a", "b"];
    for (const [index, offset] of [
      [0, 0],
      [0, -1],
      [1, 1],
      [-1, 1],
      [2, -1],
    ])
      expect(moveItem(items, index, offset)).toBe(items);
    expect(moveItem([], 0, 1)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { insertAtSelection, isCurrentRequest } from "./text-assist";

describe("tag insertion", () => {
  it("inserts at the caret without replacing surrounding syntax", () => {
    expect(insertAtSelection("{cat}, blue", 7, 7, "sun, ")).toEqual({
      text: "{cat}, sun, blue",
      caret: 12,
    });
  });
  it("replaces only a selected range and preserves Unicode outside it", () => {
    expect(insertAtSelection("猫🌟, old, 空", 5, 8, "new tag")).toEqual({
      text: "猫🌟, new tag, 空",
      caret: 12,
    });
  });
  it("clamps a selection that no longer fits the edited text", () => {
    expect(insertAtSelection("cat", 9, 12, " eyes")).toEqual({ text: "cat eyes", caret: 8 });
  });
});

describe("query freshness", () => {
  it("ignores responses from replaced input and earlier retries", () => {
    const current = { key: "jp:model:猫", sequence: 4, active: true };
    expect(isCurrentRequest({ key: "en:model:cat", sequence: 4 }, current)).toBe(false);
    expect(isCurrentRequest({ key: current.key, sequence: 3 }, current)).toBe(false);
    expect(isCurrentRequest({ key: current.key, sequence: 4 }, current)).toBe(true);
  });
  it("ignores responses after the editor closes", () => {
    expect(
      isCurrentRequest({ key: "text", sequence: 1 }, { key: "text", sequence: 1, active: false }),
    ).toBe(false);
  });
});

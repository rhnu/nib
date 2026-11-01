import { describe, expect, it } from "vitest";
import { navigationButton, navigationKey } from "./navigation-input";

const key = (key: string, altKey = false) => ({
  key,
  altKey,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
});

describe("browser navigation inputs", () => {
  it("recognizes only mouse side buttons", () => {
    expect(navigationButton(3)).toBe("back");
    expect(navigationButton(4)).toBe("forward");
    for (const button of [0, 1, 2, 5]) expect(navigationButton(button)).toBeUndefined();
  });

  it("recognizes browser keys and Alt arrows", () => {
    expect(navigationKey(key("BrowserBack"))).toBe("back");
    expect(navigationKey(key("BrowserForward"))).toBe("forward");
    expect(navigationKey(key("ArrowLeft", true))).toBe("back");
    expect(navigationKey(key("ArrowRight", true))).toBe("forward");
  });

  it("preserves ordinary editing and unrelated browser shortcuts", () => {
    for (const name of ["ArrowLeft", "ArrowRight", "Backspace", "F5", "r"])
      expect(navigationKey(key(name))).toBeUndefined();
    expect(navigationKey({ ...key("ArrowLeft", true), ctrlKey: true })).toBeUndefined();
    expect(navigationKey({ ...key("ArrowLeft", true), metaKey: true })).toBeUndefined();
    expect(navigationKey({ ...key("ArrowLeft", true), shiftKey: true })).toBeUndefined();
  });
});

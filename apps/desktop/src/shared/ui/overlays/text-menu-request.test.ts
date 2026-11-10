import { describe, expect, it } from "vitest";
import { isTextMenuRequest } from "./text-menu-request";

describe("text context menu requests", () => {
  it("keeps primary-button suggestion selection from opening an edit menu", () => {
    expect(isTextMenuRequest({ type: "contextmenu", button: 0 })).toBe(false);
    expect(isTextMenuRequest({ type: "contextmenu", button: 1 })).toBe(false);
    expect(isTextMenuRequest({ type: "click", button: 0 })).toBe(false);
  });

  it("accepts right-click and touch long press", () => {
    expect(isTextMenuRequest({ type: "contextmenu", button: 2 })).toBe(true);
    expect(isTextMenuRequest({ type: "contextmenu", button: 0, pointerType: "touch" })).toBe(true);
  });

  it("preserves menu shortcuts without treating ordinary keys or IME as menu requests", () => {
    expect(isTextMenuRequest({ type: "keydown", key: "ContextMenu" })).toBe(true);
    expect(isTextMenuRequest({ type: "keydown", key: "F10", shiftKey: true })).toBe(true);
    expect(isTextMenuRequest({ type: "keydown", key: "F10" })).toBe(false);
    expect(isTextMenuRequest({ type: "keydown", key: "Enter" })).toBe(false);
    expect(isTextMenuRequest({ type: "keydown", key: "ContextMenu", isComposing: true })).toBe(
      false,
    );
  });
});

import { describe, expect, it } from "vitest";
import { pageAtPath, startupPage } from "./navigation";

describe("startup navigation", () => {
  it("restores the persisted page when the URL has no supported destination", () => {
    expect(startupPage("/", "library", false)).toBe("library");
    expect(startupPage("/unknown", "director", false)).toBe("director");
  });
  it("uses a supported URL ahead of the persisted navigation snapshot", () => {
    expect(startupPage("/gallery", "create", false)).toBe("gallery");
    expect(startupPage("/lexicon", "create", false)).toBe("lexicon");
    expect(startupPage("/", "lexicon", false)).toBe("lexicon");
  });
  it("honors a settings choice made while workspace startup was blocked", () => {
    expect(startupPage("/gallery", "create", true)).toBe("settings");
  });
  it("does not accept an unknown location as a navigation snapshot", () => {
    expect(pageAtPath("/unknown")).toBeUndefined();
    expect(pageAtPath("/create")).toBe("create");
  });
});

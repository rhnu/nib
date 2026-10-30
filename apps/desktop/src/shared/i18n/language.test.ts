import { describe, expect, it } from "vitest";
import { resolveLanguage } from "./language";

describe("language selection", () => {
  it("preserves explicit choices regardless of system preferences", () => {
    expect(resolveLanguage("en", ["zh-CN"])).toBe("en");
    expect(resolveLanguage("zh-CN", ["en-GB"])).toBe("zh-CN");
  });

  it("matches supported system preferences and falls back to English", () => {
    expect(resolveLanguage("system", ["zh-Hans-SG"])).toBe("zh-CN");
    expect(resolveLanguage("system", ["zh-CN"])).toBe("zh-CN");
    expect(resolveLanguage("system", ["zh-Hant-TW"])).toBe("en");
    expect(resolveLanguage("system", ["fr-FR", "zh-CN"])).toBe("zh-CN");
    expect(resolveLanguage("system", ["invalid_tag", "en-AU"])).toBe("en");
    expect(resolveLanguage("system", [])).toBe("en");
  });
});

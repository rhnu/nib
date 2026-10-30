import { describe, expect, it } from "vitest";
import type { TokenFieldUsage } from "@/bindings/generation";
import { characterTokenUsage, promptTokenUsage } from "./token-usage";

describe("prompt token display scopes", () => {
  it("keeps main and character usage in separate positive and negative budgets", () => {
    const tokens: TokenFieldUsage[] = [
      { field: "prompt", used: 8, limit: 10, overLimit: false },
      { field: "negativePrompt", used: 12, limit: 10, overLimit: true },
      { field: "characters[0].prompt", used: 3, limit: 10, overLimit: false },
    ];
    const main = promptTokenUsage(tokens);
    expect(main.positive?.used).toBe(8);
    expect(main.negative?.used).toBe(12);
    expect(main.negative?.overLimit).toBe(true);
  });

  it("matches request indices to stable character identities without closing disabled gaps", () => {
    const tokens: TokenFieldUsage[] = [
      { field: "characters[2].prompt", used: 7, limit: 10, overLimit: false },
      { field: "characters[0].negativePrompt", used: 4, limit: 10, overLimit: false },
    ];
    const usages = characterTokenUsage(tokens, [
      { id: "recipe-character" },
      { id: "disabled-character" },
      { id: "direct-character" },
    ]);
    expect(usages.get("direct-character")?.positive?.used).toBe(7);
    expect(usages.get("recipe-character")?.negative?.used).toBe(4);
    expect(usages.get("disabled-character")).toEqual({ positive: undefined, negative: undefined });
  });

  it("does not report zero usage while current request data is unavailable", () => {
    expect(promptTokenUsage([])).toEqual({ positive: undefined, negative: undefined });
    expect(characterTokenUsage([], [])).toEqual(new Map());
  });
});

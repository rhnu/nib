import { describe, expect, it } from "vitest";
import type { Draft } from "../../bindings/workbench";
import { generationQuoteKey, hasResolvedPrompt } from "./quote-state";

const draft: Draft = {
  revision: 1,
  composition: { positive: [], negative: [] },
  presets: [],
  settings: { model: null, size: null, steps: null, scale: null, sampler: null },
};

describe("generation quote eligibility", () => {
  it("waits for resolved positive text, including text supplied by resources", () => {
    expect(hasResolvedPrompt(null)).toBe(false);
    expect(hasResolvedPrompt({ positive: " \n\t" })).toBe(false);
    expect(hasResolvedPrompt({ positive: "resolved chunk content" })).toBe(true);
  });

  it("leaves nonempty NAI syntax to the SDK", () => {
    expect(hasResolvedPrompt({ positive: "{}[]" })).toBe(true);
  });
});

describe("generation quote identity", () => {
  it("preserves a quote across saves but invalidates it when resources change", () => {
    expect(generationQuoteKey({ ...draft, revision: 2 }, 1)).toBe(generationQuoteKey(draft, 1));
    expect(generationQuoteKey(draft, 2)).not.toBe(generationQuoteKey(draft, 1));
  });

  it("invalidates a quote after a prompt or parameter edit", () => {
    expect(
      generationQuoteKey({
        ...draft,
        composition: {
          positive: [{ kind: "text", id: "a", enabled: true, text: "cat" }],
          negative: [],
        },
      }),
    ).not.toBe(generationQuoteKey(draft));
    expect(generationQuoteKey({ ...draft, settings: { ...draft.settings, steps: 20 } })).not.toBe(
      generationQuoteKey(draft),
    );
  });
});

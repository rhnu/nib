import { describe, expect, it } from "vitest";
import type { Draft } from "../../bindings/workbench";
import { emptyReferences, emptySettings } from "../prompt/model";
import { generationQuoteKey, hasResolvedPrompt, isQuoteEligible } from "./quote-state";

const draft: Draft = {
  revision: 1,
  composition: { positive: [], negative: [] },
  presets: [],
  settings: emptySettings(),
  characters: [],
  inputs: { operation: { kind: "textToImage" }, references: emptyReferences(), stream: null },
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

  it("allows image tools to be quoted without an unrelated generation prompt", () => {
    expect(
      isQuoteEligible(
        {
          ...draft,
          inputs: {
            ...draft.inputs,
            operation: { kind: "director", assetId: "image", command: "lineart" },
          },
        },
        null,
      ),
    ).toBe(true);
    expect(isQuoteEligible(draft, null)).toBe(false);
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

  it("invalidates a quote when an image operation or character changes", () => {
    expect(
      generationQuoteKey({
        ...draft,
        inputs: {
          ...draft.inputs,
          operation: {
            kind: "inpainting",
            assetId: "source",
            maskAssetId: "mask",
            strength: 0.5,
            noise: 0,
            addOriginalImage: true,
          },
        },
      }),
    ).not.toBe(generationQuoteKey(draft));
    expect(
      generationQuoteKey({
        ...draft,
        characters: [
          {
            id: "character",
            enabled: true,
            composition: { positive: [], negative: [] },
            position: { x: 0.3, y: 0.5 },
          },
        ],
      }),
    ).not.toBe(generationQuoteKey(draft));
  });
});

import { describe, expect, it } from "vitest";
import type { Draft } from "@/bindings/workbench";
import { emptyReferences, emptySettings } from "./model";
import { promptModelContext } from "./model-context";

const draft: Draft = {
  activePage: "create",
  composition: { positive: [], negative: [] },
  presets: [],
  settings: { ...emptySettings(), model: "model-a" },
  characters: [],
  inputs: {
    requestCount: 1,
    operation: { kind: "textToImage" },
    references: emptyReferences(),
    stream: null,
    policy: "normalize",
  },
  maskEditor: { activeSourceId: null, sessions: [] },
  vibeEncoder: null,
  director: { selectedTool: "lineart", tools: [] },
  pngTextEditor: { sessions: [] },
  promptEditor: { collapsedBlocks: {} },
};

describe("model-specific display retention", () => {
  it("retains display context while prompt and ordinary parameters are edited", () => {
    expect(
      promptModelContext({
        ...draft,
        composition: {
          positive: [{ id: "source", kind: "text", enabled: true, text: "a cat" }],
          negative: [],
        },
        settings: { ...draft.settings, steps: 25 },
      }),
    ).toBe(promptModelContext(draft));
  });

  it("clears retained display for a different requested model or image operation", () => {
    expect(
      promptModelContext({ ...draft, settings: { ...draft.settings, model: "model-b" } }),
    ).not.toBe(promptModelContext(draft));
    expect(
      promptModelContext({
        ...draft,
        inputs: {
          ...draft.inputs,
          operation: { kind: "upscale", assetId: "image", model: "upscaler", declaredBlurSigma: 0 },
        },
      }),
    ).not.toBe(promptModelContext(draft));
  });
});

import { describe, expect, it } from "vitest";
import type { CreationOperation, Draft } from "../../../bindings/workbench";
import { emptyReferences, emptySettings } from "../../prompt/model";
import {
  generationQuoteKey,
  hasResolvedPrompt,
  isQuoteEligible,
  isOperationEffective,
} from "./quote-state";

const draft: Draft = {
  vibeEncoder: null,
  director: { selectedTool: "lineart", tools: [] },
  pngTextEditor: { sessions: [] },
  activePage: "create",
  revision: 1,
  maskEditor: { activeSourceId: null, sessions: [] },
  composition: { positive: [], negative: [] },
  presets: [],
  settings: emptySettings(),
  characters: [],
  inputs: {
    requestCount: 1,
    operation: { kind: "textToImage" },
    references: emptyReferences(),
    stream: null,
    policy: "normalize",
  },
};

describe("effective image operation", () => {
  it("requires an explicit pure infill choice when the SDK removes local conditioning", () => {
    const pure: Extract<CreationOperation, { kind: "inpainting" }> = {
      kind: "inpainting",
      assetId: "source",
      maskAssetId: "mask",
      img2img: null,
      addOriginalImage: true,
    };
    const conditioned = {
      ...pure,
      img2img: { strength: 0.5, noise: 0.1, color_correct: true, extra_noise_seed: 7 },
    };
    expect(isOperationEffective(conditioned, pure)).toBe(false);
    expect(isOperationEffective(conditioned, conditioned)).toBe(true);
    expect(isOperationEffective(pure, pure)).toBe(true);
    expect(isOperationEffective(pure, { kind: "textToImage" })).toBe(false);
  });
  it("does not submit an ordinary SDK result under a requested Max Enhance action", () => {
    const requested: Extract<CreationOperation, { kind: "imageToImage" }> = {
      kind: "imageToImage",
      assetId: "source",
      strength: 0.7,
      noise: 0,
      colorCorrect: true,
      extraNoiseSeed: null,
      addOriginalImage: true,
      maxEnhance: true,
    };
    expect(isOperationEffective(requested, { ...requested, maxEnhance: false })).toBe(false);
    expect(isOperationEffective(requested, requested)).toBe(true);
    expect(
      isOperationEffective(
        { ...requested, maxEnhance: false },
        { ...requested, maxEnhance: false },
      ),
    ).toBe(true);
  });
});

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
    expect(
      isQuoteEligible(
        {
          ...draft,
          inputs: {
            ...draft.inputs,
            operation: {
              kind: "upscale",
              assetId: "image",
              model: "nai-diffusion-5-curated",
              declaredBlurSigma: 0,
            },
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

  it("does not invalidate frozen generation content for independent mask editing", () => {
    expect(
      generationQuoteKey({
        ...draft,
        maskEditor: { activeSourceId: "editing-source", sessions: [] },
      }),
    ).toBe(generationQuoteKey(draft));
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

  it("invalidates after account refresh or request policy changes", () => {
    expect(generationQuoteKey(draft, [1, 2])).not.toBe(generationQuoteKey(draft, [1, 1]));
    expect(
      generationQuoteKey({ ...draft, inputs: { ...draft.inputs, policy: "reject" } }),
    ).not.toBe(generationQuoteKey(draft));
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
            img2img: null,
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

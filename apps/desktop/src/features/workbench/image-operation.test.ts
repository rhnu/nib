import { describe, expect, it } from "vitest";
import type { MediaAsset } from "../../bindings/media";
import type { CreationOperation, Draft } from "../../bindings/workbench";
import { emptyComposition, emptyReferences, emptySettings } from "../prompt/model";
import {
  applyImageOperation,
  imageOperationNeedsConfirmation,
  optionalImageSeed,
} from "./image-operation";

const source: MediaAsset = {
  id: "source",
  kind: "image",
  mimeType: "image/png",
  byteLength: 1024,
  width: 640,
  height: 832,
  createdAt: 1,
  source: { kind: "import", name: "source.png" },
  available: true,
};
const imageOperation = (
  assetId = source.id,
): Extract<CreationOperation, { kind: "imageToImage" }> => ({
  kind: "imageToImage",
  assetId,
  strength: 0.35,
  noise: 0.2,
  colorCorrect: false,
  extraNoiseSeed: 0,
  addOriginalImage: false,
  maxEnhance: false,
});
const creation = (operation: CreationOperation): Draft => ({
  revision: 1,
  maskEditor: { activeSourceId: null, sessions: [] },
  composition: emptyComposition(),
  presets: [],
  characters: [],
  settings: emptySettings(),
  inputs: { operation, policy: "normalize", stream: null, references: emptyReferences() },
});

describe("image operation changes", () => {
  it("keeps edited img2img values including false and zero when replacing the source", () => {
    const original = creation(imageOperation());
    const replacement = { ...source, id: "replacement" };
    const defaults = {
      ...imageOperation(replacement.id),
      strength: 0.7,
      noise: 0,
      colorCorrect: true,
      extraNoiseSeed: null,
    };
    const next = applyImageOperation(original, replacement, defaults);
    expect(next.inputs.operation).toEqual({ ...original.inputs.operation, assetId: "replacement" });
    expect(original.inputs.operation).toEqual(imageOperation());
    expect(imageOperationNeedsConfirmation(original, next)).toBe(true);
  });

  it("uses the actual source dimensions for Max Enhance and retains all image edits", () => {
    const original = creation(imageOperation());
    original.settings.size = { width: 512, height: 512 };
    const next = applyImageOperation(original, source, { ...imageOperation(), maxEnhance: true });
    expect(next.settings.size).toEqual({ width: 640, height: 832 });
    expect(next.inputs.operation).toEqual({ ...original.inputs.operation, maxEnhance: true });
    expect(imageOperationNeedsConfirmation(original, next)).toBe(true);
  });

  it("switches img2img and Max Enhance directly when no source or size is lost", () => {
    const original = creation(imageOperation());
    original.settings.size = { width: 640, height: 832 };
    const next = applyImageOperation(original, source, { ...imageOperation(), maxEnhance: true });
    expect(imageOperationNeedsConfirmation(original, next)).toBe(false);
  });

  it("requires confirmation to leave an image operation and preserves other draft content", () => {
    const original = creation(imageOperation());
    original.settings.seed = 0;
    original.composition.positive.push({
      kind: "text",
      id: "prompt",
      enabled: true,
      text: "sample",
    });
    const upscale: CreationOperation = {
      kind: "upscale",
      assetId: source.id,
      model: "chosen-model",
      declaredBlurSigma: 0,
    };
    const next = applyImageOperation(original, source, upscale);
    expect(next.inputs.operation).toEqual(upscale);
    expect(next.settings).toEqual(original.settings);
    expect(next.composition).toBe(original.composition);
    expect(next.inputs.references).toBe(original.inputs.references);
    expect(imageOperationNeedsConfirmation(original, next)).toBe(true);
    const text = {
      ...original,
      inputs: { ...original.inputs, operation: { kind: "textToImage" } as CreationOperation },
    };
    expect(imageOperationNeedsConfirmation(original, text)).toBe(true);
    expect(imageOperationNeedsConfirmation(text, original)).toBe(false);
  });

  it("keeps upscaler parameters across source changes and avoids interrupting the same selection", () => {
    const upscale: CreationOperation = {
      kind: "upscale",
      assetId: source.id,
      model: "chosen-model",
      declaredBlurSigma: 0.4,
    };
    const original = creation(upscale);
    const defaults: CreationOperation = {
      kind: "upscale",
      assetId: source.id,
      model: "sdk-default",
      declaredBlurSigma: 0,
    };
    const identical = applyImageOperation(original, source, defaults);
    expect(identical.inputs.operation).toEqual(upscale);
    expect(imageOperationNeedsConfirmation(original, identical)).toBe(false);
    const changed = applyImageOperation(
      original,
      { ...source, id: "replacement" },
      { ...defaults, assetId: "replacement" },
    );
    expect(changed.inputs.operation).toEqual({ ...upscale, assetId: "replacement" });
    expect(imageOperationNeedsConfirmation(original, changed)).toBe(true);
  });
});

describe("optional image seed", () => {
  it("preserves zero and absence while excluding nonfinite values", () => {
    expect(optionalImageSeed("0")).toBe(0);
    expect(optionalImageSeed("")).toBeNull();
    expect(optionalImageSeed("42")).toBe(42);
    expect(optionalImageSeed("Infinity")).toBeNull();
    expect(optionalImageSeed("invalid")).toBeNull();
  });
});

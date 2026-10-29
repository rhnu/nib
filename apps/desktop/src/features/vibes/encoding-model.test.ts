import { describe, expect, it } from "vitest";
import type { Draft, VibeEncodingInput } from "../../bindings/workbench";
import { emptyComposition, emptyReferences, emptySettings } from "../prompt/model";
import { encodingSubmission, isReusableEncoding, optionalEncodingSeed } from "./encoding-model";
import type { ResultSummary } from "../../bindings/generation";
import { generationQuoteKey } from "../generation/submission/quote-state";

const input: VibeEncodingInput = {
  assetId: "source",
  model: "encoding-model",
  informationExtracted: 0.7,
  maskAssetId: "mask",
  cropToMask: false,
  focusSeed: 0,
  infoExtractSeed: -42,
};
const draft: Draft = {
  revision: 1,
  composition: emptyComposition(),
  characters: [],
  presets: [],
  settings: emptySettings(),
  inputs: {
    requestCount: 1,
    operation: { kind: "textToImage" },
    policy: "reject",
    stream: null,
    references: emptyReferences(),
  },
  maskEditor: { activeSourceId: null, sessions: [] },
  vibeEncoder: input,
  director: { selectedTool: "lineart", tools: [] },
  pngTextEditor: { sessions: [] },
  activePage: "create",
};

describe("independent Vibe encoding", () => {
  it("recognizes retained encoding at the IPC numeric precision and rejects missing files", () => {
    const result: ResultSummary = {
      id: "result",
      jobId: "job",
      sampleIndex: 0,
      assetId: "encoding",
      kind: "vibe",
      imageSource: null,
      seed: null,
      createdAt: 1,
      mimeType: "application/octet-stream",
      available: true,
      operation: {
        kind: "encodeVibe",
        input: { ...input, informationExtracted: 0.699999988079071 },
      },
    };
    expect(isReusableEncoding(result, input)).toBe(true);
    expect(isReusableEncoding({ ...result, available: false }, input)).toBe(false);
    expect(isReusableEncoding(result, { ...input, informationExtracted: 0.6 })).toBe(false);
    expect(isReusableEncoding(result, { ...input, maskAssetId: null })).toBe(false);
    expect(isReusableEncoding(result, { ...input, infoExtractSeed: 0 })).toBe(false);
  });
  it("preserves the editable generation while constructing a separate paid operation", () => {
    const submitted = encodingSubmission(draft, input);
    expect(submitted.inputs.operation).toEqual({ kind: "encodeVibe", ...input });
    expect(submitted.inputs.policy).toBe("reject");
    expect(submitted.inputs.references).toBe(draft.inputs.references);
    expect(draft.inputs.operation).toEqual({ kind: "textToImage" });
    expect(draft.vibeEncoder).toBe(input);
    expect(submitted.vibeEncoder).toBeNull();
  });
  it("does not invalidate generation estimates for changes to encoding editor inputs", () => {
    expect(
      generationQuoteKey({ ...draft, vibeEncoder: { ...input, informationExtracted: 0.2 } }),
    ).toBe(generationQuoteKey(draft));
    expect(
      generationQuoteKey(encodingSubmission(draft, { ...input, informationExtracted: 0.2 })),
    ).not.toBe(generationQuoteKey(encodingSubmission(draft, input)));
  });
  it("keeps explicit zero and signed seeds distinct from omitted seeds", () => {
    expect(optionalEncodingSeed("0")).toBe(0);
    expect(optionalEncodingSeed("-42")).toBe(-42);
    expect(optionalEncodingSeed("")).toBeNull();
    expect(optionalEncodingSeed("1.5")).toBeNull();
    expect(optionalEncodingSeed("NaN")).toBeNull();
  });
});

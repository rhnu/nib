import { MessageError } from "@/shared/i18n";
import { describe, expect, it } from "vitest";
import type { Draft } from "@/bindings/workbench";
import { emptyReferences, emptySettings } from "@/features/prompt/model";
import { prepareResubmission } from "./result-resubmit-model";

function restoredDraft(): Draft {
  return {
    revision: 7,
    composition: {
      positive: [{ kind: "text", id: "main-prompt", enabled: true, text: "forest" }],
      negative: [],
    },
    presets: [],
    characters: [],
    settings: { ...emptySettings(), steps: 28 },
    inputs: {
      requestCount: 1,
      operation: {
        kind: "imageToImage",
        assetId: "main-source",
        strength: 0.65,
        noise: 0.1,
        colorCorrect: true,
        extraNoiseSeed: 0,
        addOriginalImage: true,
        maxEnhance: false,
      },
      policy: "normalize",
      stream: null,
      references: emptyReferences(),
    },
    director: {
      selectedTool: "colorize",
      tools: [
        {
          tool: "colorize",
          assetId: "restored-director-source",
          command: { colorize: { prompt: "blue hair", defry: 2 } },
          policy: "reject",
          selectedResultId: null,
        },
      ],
    },
    maskEditor: { activeSourceId: null, sessions: [] },
    vibeEncoder: null,
    pngTextEditor: { sessions: [] },
    activePage: "director",
  };
}

describe("result resubmission preparation", () => {
  it("resubmits restored Director input while preserving the existing main image operation", () => {
    const restored = restoredDraft();
    const before = structuredClone(restored);
    const prepared = prepareResubmission(restored, "director");

    expect(prepared.inputs.operation).toEqual({
      kind: "director",
      assetId: "restored-director-source",
      command: { colorize: { prompt: "blue hair", defry: 2 } },
    });
    expect(prepared.inputs.policy).toBe("reject");
    expect(restored).toEqual(before);
    expect(restored.inputs.operation).toMatchObject({
      kind: "imageToImage",
      assetId: "main-source",
    });
  });

  it.each(["generation", "upscale", "encodeVibe"] as const)(
    "keeps restored %s submissions unchanged",
    (kind) => {
      const restored = restoredDraft();
      expect(prepareResubmission(restored, kind)).toBe(restored);
    },
  );

  it("rejects Director resubmission without its restored source instead of using the main source", () => {
    const restored = restoredDraft();
    restored.director.tools[0].assetId = null;
    expect(() => prepareResubmission(restored, "director")).toThrow(MessageError);
    expect(restored.inputs.operation).toMatchObject({
      kind: "imageToImage",
      assetId: "main-source",
    });
  });
});

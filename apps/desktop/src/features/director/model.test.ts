import { describe, expect, it } from "vitest";
import type { DirectorWorkspace, Draft } from "../../bindings/workbench";
import { emptyComposition, emptyReferences, emptySettings } from "../prompt/model";
import { generationQuoteKey } from "../generation/submission/quote-state";
import {
  commandTool,
  directorSubmission,
  restoreDirectorWorkspace,
  updateDirectorTool,
} from "./model";

const director: DirectorWorkspace = {
  selectedTool: "emotion",
  tools: [
    {
      tool: "emotion",
      assetId: "face",
      command: { emotion: { prompt: "happy", defry: 0 } },
      policy: "reject",
      selectedResultId: "previous-expression",
    },
    {
      tool: "colorize",
      assetId: "lineart",
      command: { colorize: { prompt: "red hair", defry: 2 } },
      policy: "normalize",
      selectedResultId: "previous-colors",
    },
  ],
};

const draft: Draft = {
  revision: 4,
  composition: {
    positive: [{ kind: "text", id: "main-prompt", enabled: true, text: "landscape" }],
    negative: [],
  },
  presets: [],
  characters: [],
  settings: { ...emptySettings(), steps: 28 },
  inputs: {
    operation: { kind: "textToImage" },
    policy: "normalize",
    stream: "sse",
    references: emptyReferences(),
  },
  maskEditor: { activeSourceId: null, sessions: [] },
  vibeEncoder: null,
  pngTextEditor: { sessions: [] },
  activePage: "director",
  director,
};

describe("independent Director state", () => {
  it("freezes the selected tool while leaving the editable creation intact", () => {
    const submitted = directorSubmission(draft)!;
    expect(submitted.inputs).toEqual({
      operation: {
        kind: "director",
        assetId: "face",
        command: { emotion: { prompt: "happy", defry: 0 } },
      },
      policy: "reject",
      stream: null,
      references: emptyReferences(),
    });
    expect(submitted.composition).toEqual(emptyComposition());
    expect(submitted.settings.steps).toBeNull();
    expect(draft.composition.positive[0]).toMatchObject({ text: "landscape" });
    expect(draft.inputs.operation.kind).toBe("textToImage");
    expect(draft.director).toBe(director);
  });

  it("does not submit a tool without a source image", () => {
    expect(
      directorSubmission({
        ...draft,
        director: updateDirectorTool(director, "emotion", { assetId: null }),
      }),
    ).toBeNull();
  });

  it("keeps selection and unrelated creation edits out of Director quote identity", () => {
    const changed: Draft = {
      ...draft,
      revision: 100,
      activePage: "create",
      settings: { ...draft.settings, steps: 50 },
      director: updateDirectorTool(director, "emotion", { selectedResultId: "older-expression" }),
    };
    expect(generationQuoteKey(directorSubmission(changed)!)).toBe(
      generationQuoteKey(directorSubmission(draft)!),
    );
    const edited = {
      ...draft,
      director: updateDirectorTool(director, "emotion", {
        command: { emotion: { prompt: "sad", defry: 0 } },
      }),
    };
    expect(generationQuoteKey(directorSubmission(edited)!)).not.toBe(
      generationQuoteKey(directorSubmission(draft)!),
    );
  });

  it("restores one tool without discarding other tool inputs, parameters or selected output", () => {
    const restored = restoreDirectorWorkspace(director, {
      kind: "director",
      assetId: "restored-lineart",
      command: { colorize: { prompt: "blue hair", defry: 1 } },
    });
    expect(restored.selectedTool).toBe("colorize");
    expect(restored.tools[0]).toBe(director.tools[0]);
    expect(restored.tools[1]).toMatchObject({
      assetId: "restored-lineart",
      command: { colorize: { prompt: "blue hair", defry: 1 } },
      selectedResultId: "previous-colors",
    });
    expect(director.selectedTool).toBe("emotion");
  });

  it("distinguishes both cleanup operations", () => {
    expect(commandTool("declutter")).toBe("declutter");
    expect(commandTool("declutter_keep_bubbles")).toBe("declutterKeepBubbles");
  });
});

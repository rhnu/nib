import { describe, expect, it } from "vitest";
import type { CharacterComposition, Draft } from "@/bindings/workbench";
import {
  emptyComposition,
  emptyReferences,
  emptySettings,
  textNode,
} from "@/features/prompt/model";
import { applyMetadataImport, type MetadataSelection } from "./metadata-import";

const selection: MetadataSelection = {
  prompt: false,
  negativePrompt: false,
  characters: false,
  settings: false,
  seed: false,
};

const creation = (): Draft => ({
  composition: emptyComposition(),
  presets: [],
  characters: [],
  settings: emptySettings(),
  vibeEncoder: null,
  director: { selectedTool: "lineart", tools: [] },
  pngTextEditor: { sessions: [] },
  promptEditor: { collapsedBlocks: {} },
  activePage: "create",
  maskEditor: { activeSourceId: null, sessions: [] },
  inputs: {
    requestCount: 1,
    operation: { kind: "textToImage" },
    policy: "normalize",
    stream: null,
    references: emptyReferences(),
  },
});

describe("selected metadata import", () => {
  it("retains the creation when no fields are selected", () => {
    const current = creation();
    expect(applyMetadataImport(current, creation(), selection)).toEqual(current);
  });
  it("appends a separate prompt block by default and avoids adding automatic tags twice", () => {
    const current = creation();
    current.composition.positive = [textNode("existing prompt")];
    current.composition.negative = [textNode("keep me")];
    current.settings.seed = 42;
    const source = creation();
    source.composition.positive = [textNode("recorded prompt")];
    source.settings.quality = "none";
    source.settings.seed = 7;
    const result = applyMetadataImport(current, source, { ...selection, prompt: true });
    expect(result.composition.positive.map((node) => node.kind === "text" && node.text)).toEqual([
      "existing prompt",
      "recorded prompt",
    ]);
    expect(result.composition.negative).toEqual(current.composition.negative);
    expect(result.settings.quality).toBe("none");
    expect(result.settings.seed).toBe(42);
    expect(result.inputs).toBe(current.inputs);
    expect(result.presets).toBe(current.presets);
    expect(current.composition.positive).toHaveLength(1);
  });
  it("applies known settings without clearing missing values and treats a zero seed independently", () => {
    const current = creation();
    current.settings.steps = 28;
    current.settings.seed = 42;
    const source = creation();
    source.settings.scale = 0;
    source.settings.seed = 0;
    const settingsOnly = applyMetadataImport(current, source, { ...selection, settings: true });
    expect(settingsOnly.settings.steps).toBe(28);
    expect(settingsOnly.settings.scale).toBe(0);
    expect(settingsOnly.settings.seed).toBe(42);
    expect(applyMetadataImport(current, source, { ...selection, seed: true }).settings.seed).toBe(
      0,
    );
  });
  it("imports characters independently of the main prompt and other settings", () => {
    const current = creation();
    current.composition.positive = [textNode("main prompt")];
    const source = creation();
    source.characters = [
      {
        id: "actor",
        enabled: true,
        composition: { positive: [textNode("blue eyes")], negative: [] },
        position: { x: 0.5, y: 0.5 },
      },
    ];
    const result = applyMetadataImport(current, source, { ...selection, characters: true });
    expect(result.characters[0].composition.positive[0]).toMatchObject({ text: "blue eyes" });
    expect(result.characters[0].position).toEqual({ x: 0.5, y: 0.5 });
    expect(result.composition).toEqual(current.composition);
    expect(result.settings).toEqual(current.settings);
  });
  it("replaces selected direct content only when replacement is explicitly selected", () => {
    const current = creation();
    current.composition.positive = [textNode("old")];
    current.composition.negative = [textNode("keep")];
    const source = creation();
    source.composition.positive = [textNode("replacement")];
    const result = applyMetadataImport(current, source, { ...selection, prompt: true }, "replace");
    expect(result.composition.positive).toHaveLength(1);
    expect(result.composition.positive[0]).toMatchObject({ text: "replacement" });
    expect(result.composition.negative).toEqual(current.composition.negative);
  });
  it("uses independent identities for repeated prompt imports", () => {
    const source = creation();
    source.composition.positive = [textNode("recorded")];
    const first = applyMetadataImport(creation(), source, { ...selection, prompt: true });
    const second = applyMetadataImport(first, source, { ...selection, prompt: true });
    expect(second.composition.positive).toHaveLength(2);
    expect(second.composition.positive[0].id).not.toBe(second.composition.positive[1].id);
  });
  it("appends character prompts in display order and keeps existing role state", () => {
    const role = (id: string, text: string): CharacterComposition => ({
      id,
      enabled: false,
      position: { x: 0.2, y: 0.7 },
      composition: { positive: [textNode(text)], negative: [] },
    });

    const current = creation();
    current.presets = [
      {
        id: "preset",
        enabled: true,
        binding: {
          kind: "expanded",
          name: "preset",
          composition: emptyComposition(),
          defaults: emptySettings(),
          characters: [role("shared", "preset text")],
          references: emptyReferences(),
        },
      },
    ];
    current.characters = [role("shared", "direct text"), role("untouched", "keep")];
    const source = creation();
    source.characters = [role("incoming-0", "first"), role("incoming-1", "second")];
    source.characters[0].composition.negative = [textNode("avoid first")];
    const result = applyMetadataImport(current, source, { ...selection, characters: true });
    const binding = result.presets[0].binding;
    if (binding.kind !== "expanded") throw new Error("expected expanded preset");
    expect(
      binding.characters[0].composition.positive.map((node) => node.kind === "text" && node.text),
    ).toEqual(["preset text", "first"]);
    expect(binding.characters[0].composition.negative[0]).toMatchObject({ text: "avoid first" });
    expect(
      result.characters[0].composition.positive.map((node) => node.kind === "text" && node.text),
    ).toEqual(["direct text", "second"]);
    expect(result.characters[0].id).toBe("shared");
    expect(result.characters[0].enabled).toBe(false);
    expect(result.characters[0].position).toEqual({ x: 0.2, y: 0.7 });
    expect(result.characters[1]).toEqual(current.characters[1]);
    expect(current.characters[0].composition.positive).toHaveLength(1);
  });
  it("creates only missing roles and skips empty appended prompt blocks", () => {
    const current = creation();
    current.characters = [
      {
        id: "existing",
        enabled: true,
        position: { x: 0.1, y: 0.2 },
        composition: { positive: [textNode("keep")], negative: [] },
      },
    ];
    const source = creation();
    source.characters = [
      {
        id: "one",
        enabled: true,
        position: { x: 0.5, y: 0.5 },
        composition: { positive: [textNode("")], negative: [] },
      },
      {
        id: "two",
        enabled: true,
        position: { x: 0.5, y: 0.5 },
        composition: { positive: [textNode("new character")], negative: [] },
      },
    ];
    const result = applyMetadataImport(current, source, { ...selection, characters: true });
    expect(result.characters).toHaveLength(2);
    expect(result.characters[0].composition.positive).toEqual(
      current.characters[0].composition.positive,
    );
    expect(result.characters[1].composition.positive[0]).toMatchObject({ text: "new character" });
    expect(result.characters[1].id).not.toBe(source.characters[1].id);
  });
});

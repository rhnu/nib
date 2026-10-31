import { describe, expect, it } from "vitest";
import type { CharacterComposition, PresetInstance } from "@/bindings/workbench";
import {
  emptyComposition,
  emptyReferences,
  emptySettings,
  textNode,
} from "@/features/prompt/model";
import { appendRecognizedTags, tagPromptTargets } from "./tag-prompt";

const character = (id: string): CharacterComposition => ({
  id,
  enabled: true,
  composition: emptyComposition(),
  position: { x: 0.5, y: 0.5 },
});

const content = () => ({
  composition: { positive: [textNode("existing prompt")], negative: [] },
  characters: [character("same")],
  presets: ["first", "second"].map((id): PresetInstance => ({
    id,
    enabled: true,
    binding: {
      kind: "expanded",
      name: id,
      composition: emptyComposition(),
      defaults: emptySettings(),
      characters: [character("same")],
      references: emptyReferences(),
    },
  })),
});

describe("recognized tag prompt targets", () => {
  it("appends an independent fragment without rewriting the existing prompt", () => {
    const original = content();
    const result = appendRecognizedTags(original, { key: "main", label: "main" }, "new tag");
    expect(result?.composition.positive.map((node) => node.kind === "text" && node.text)).toEqual([
      "existing prompt",
      "new tag",
    ]);
    expect(original.composition.positive).toHaveLength(1);
    expect(result?.characters).toEqual(original.characters);
  });

  it("distinguishes scoped character targets and modifies only the selected character", () => {
    const original = content();
    const targets = tagPromptTargets(original, new Map());
    expect(new Set(targets.map((target) => target.key)).size).toBe(4);
    const selected = targets.find((target) => target.presetId === "second")!;
    const result = appendRecognizedTags(original, selected, "character tag");
    const second = result?.presets[1].binding;
    expect(
      second?.kind === "expanded" && second.characters[0].composition.positive[0],
    ).toMatchObject({ kind: "text", text: "character tag" });
    expect(result?.presets[0]).toEqual(original.presets[0]);
    expect(result?.characters).toEqual(original.characters);
  });

  it("rejects a character target removed after recognition", () => {
    expect(
      appendRecognizedTags(
        content(),
        { key: "missing", label: "missing", characterId: "removed" },
        "tag",
      ),
    ).toBeNull();
  });
});

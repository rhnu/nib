import { describe, expect, it } from "vitest";
import type { CharacterComposition, Draft, PromptNode, Resource } from "../../bindings/workbench";
import { emptyComposition, emptyReferences, emptySettings } from "../prompt/model";
import { draftResourceIds, resourceDependencies } from "./resource-dependencies";

const reference = (resourceId: string): PromptNode => ({
  kind: "chunk",
  id: `node-${resourceId}`,
  enabled: false,
  resourceId,
  overrideText: null,
});
const character = (resourceId: string): CharacterComposition => ({
  id: `character-${resourceId}`,
  enabled: false,
  position: { x: 0.5, y: 0.5 },
  composition: { positive: [reference(resourceId)], negative: [] },
});

describe("resource dependencies", () => {
  it("deduplicates draft roots across scopes, roles and disabled linked or expanded presets", () => {
    const draft: Draft = {
      revision: 0,
      composition: { positive: [reference("shared")], negative: [reference("negative")] },
      characters: [character("role")],
      presets: [
        {
          id: "linked",
          enabled: false,
          binding: {
            kind: "linked",
            resourceId: "recipe",
            overrides: [],
            settingsOverrides: emptySettings(),
            outputOverrides: {
              characters: [],
              precise: [],
              vibes: [],
              normalizeVibeStrength: null,
            },
          },
        },
        {
          id: "expanded",
          enabled: false,
          binding: {
            kind: "expanded",
            name: "Detached",
            composition: { positive: [reference("shared")], negative: [reference("expanded")] },
            defaults: emptySettings(),
            characters: [character("role"), character("character")],
            references: emptyReferences(),
          },
        },
      ],
      settings: emptySettings(),
      inputs: {
        requestCount: 1,
        operation: { kind: "textToImage" },
        references: emptyReferences(),
        policy: "normalize",
        stream: null,
      },
      maskEditor: { activeSourceId: null, sessions: [] },
      vibeEncoder: null,
      director: { selectedTool: "lineart", tools: [] },
      pngTextEditor: { sessions: [] },
      activePage: "create",
    };
    expect(draftResourceIds(draft)).toEqual([
      "character",
      "expanded",
      "negative",
      "recipe",
      "role",
      "shared",
    ]);
  });

  it("includes disabled resource outputs without interpreting literal Chunk text as references", () => {
    const preset: Resource = {
      id: "preset",
      revision: 1,
      name: "Preset",
      content: {
        kind: "preset",
        composition: {
          ...emptyComposition(),
          positive: [reference("base")],
          negative: [reference("shared")],
        },
        defaults: emptySettings(),
        characters: [character("role"), character("shared")],
        references: emptyReferences(),
      },
    };
    expect([...new Set(resourceDependencies(preset))].sort()).toEqual(["base", "role", "shared"]);
    expect(
      resourceDependencies({
        id: "literal",
        revision: 1,
        name: "Literal",
        content: { kind: "chunk", text: "base role shared" },
      }),
    ).toEqual([]);
  });
});

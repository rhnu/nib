import { describe, expect, it } from "vitest";
import type {
  CharacterComposition,
  Draft,
  Resource,
  ResolvedCharacter,
  ResolvedDraft,
} from "@/bindings/workbench";
import { emptyComposition, emptyReferences, emptySettings } from "@/features/prompt/model";
import { outputIdentity } from "@/features/prompt/output-identity";
import { collectOutputIssues, outputTarget } from "@/features/workbench/output-issues";
import {
  applyCharacterPosition,
  characterDefinition,
  characterKey,
  livePositionCharacters,
  normalizePosition,
} from "./model";

const character = (id: string): CharacterComposition => ({
  id,
  enabled: true,
  composition: emptyComposition(),
  position: { x: 0.5, y: 0.5 },
});

const resource: Resource = {
  id: "resource",
  description: "",
  aliases: [],
  tags: [],
  models: [],
  folderId: null,
  coverAssetId: null,
  createdAt: 0,
  updatedAt: 0,
  name: "recipe",
  content: {
    kind: "preset",
    composition: emptyComposition(),
    defaults: emptySettings(),
    characters: [character("role:with:colons")],
    references: {
      ...emptyReferences(),
      precise: [
        {
          id: "ref:local",
          enabled: true,
          assetId: "image",
          referenceType: "character",
          strength: 1,
          fidelity: 1,
          informationExtracted: 1,
        },
      ],
    },
  },
};
const resources = new Map([[resource.id, resource]]);

const creation = (): Draft => ({
  vibeEncoder: null,
  director: { selectedTool: "lineart", tools: [] },
  pngTextEditor: { sessions: [] },
  promptEditor: { collapsedBlocks: {} },
  activePage: "create",
  composition: emptyComposition(),
  characters: [character("direct")],
  settings: emptySettings(),
  maskEditor: { activeSourceId: null, sessions: [] },
  inputs: {
    requestCount: 1,
    operation: { kind: "textToImage" },
    policy: "normalize",
    stream: null,
    references: emptyReferences(),
  },
  presets: ["first:instance", "second"].map((id) => ({
    id,
    enabled: true,
    binding: {
      kind: "linked",
      resourceId: resource.id,
      overrides: [],
      settingsOverrides: emptySettings(),
      outputOverrides: { characters: [], precise: [], vibes: [], normalizeVibeStrength: null },
    },
  })),
});

const resolvedCharacter = (
  localId = "role:with:colons",
  presetInstanceId: string | null = "first:instance",
): ResolvedCharacter => ({
  id: outputIdentity(presetInstanceId, localId),
  presetInstanceId,
  enabled: true,
  positive: "girl",
  negative: "blur",
  position: { x: 0.5, y: 0.5 },
  fragments: [],
  resourceId: presetInstanceId ? resource.id : null,
  expanded: false,
  overridden: false,
});

describe("live character positioning", () => {
  it("keeps legal direct and preset identities distinct when colon concatenation would collide", () => {
    const value = creation();
    value.characters = [character("a:b:c")];
    value.presets = value.presets.map((instance, index) => ({
      ...instance,
      id: index === 0 ? "a" : "a:b",
    }));
    const source: Resource = {
      ...resource,
      content: {
        kind: "preset",
        composition: emptyComposition(),
        defaults: emptySettings(),
        characters: [character("b:c"), character("c")],
        references: emptyReferences(),
      },
    };
    const definitions = new Map([[source.id, source]]);
    const resolved = [
      resolvedCharacter("a:b:c", null),
      resolvedCharacter("b:c", "a"),
      resolvedCharacter("c", "a:b"),
    ];
    expect(new Set(resolved.map((item) => item.id)).size).toBe(3);
    expect(resolved.map((item) => characterDefinition(value, definitions, item)?.id)).toEqual([
      "a:b:c",
      "b:c",
      "c",
    ]);
    const next = applyCharacterPosition(value, definitions, resolved[1], { x: 0.2, y: 0.3 });
    expect(next.characters).toBe(value.characters);
    expect(next.presets[1]).toBe(value.presets[1]);
    expect(
      next.presets[0].binding.kind === "linked" &&
        next.presets[0].binding.outputOverrides.characters,
    ).toEqual([{ characterId: "b:c", enabled: null, position: { x: 0.2, y: 0.3 } }]);
  });
  it("updates only the exact owning preset instance and preserves the other local fields", () => {
    const original = creation();
    const first = original.presets[0].binding;
    if (first.kind !== "linked") throw new Error("fixture");
    first.outputOverrides.characters.push({
      characterId: "role:with:colons",
      enabled: false,
      position: null,
    });
    const next = applyCharacterPosition(original, resources, resolvedCharacter(), {
      x: 0.2,
      y: 0.8,
    });
    expect(next.presets[1]).toBe(original.presets[1]);
    expect(
      next.presets[0].binding.kind === "linked" &&
        next.presets[0].binding.outputOverrides.characters,
    ).toEqual([{ characterId: "role:with:colons", enabled: false, position: { x: 0.2, y: 0.8 } }]);
    expect(original.presets[0].binding).toBe(first);
    expect(first.outputOverrides.characters[0].position).toBeNull();
    expect(next.settings.useCoords).toBe(true);
  });
  it("keeps markers on the newest coordinate while text resolution is still old", () => {
    const next = applyCharacterPosition(creation(), resources, resolvedCharacter(), {
      x: 0.13,
      y: 0.87,
    });
    expect(livePositionCharacters(next, resources, [resolvedCharacter()])[0].position).toEqual({
      x: 0.13,
      y: 0.87,
    });
    expect(resource.content.kind === "preset" && resource.content.characters[0].position).toEqual({
      x: 0.5,
      y: 0.5,
    });
  });
  it("updates direct and expanded roles without changing unrelated creation content", () => {
    const original = creation();
    const direct = applyCharacterPosition(original, resources, resolvedCharacter("direct", null), {
      x: 0.1,
      y: 0.2,
    });
    expect(direct.characters[0].position).toEqual({ x: 0.1, y: 0.2 });
    expect(direct.inputs).toBe(original.inputs);
    if (resource.content.kind !== "preset") throw new Error("fixture");
    original.presets[0].binding = {
      kind: "expanded",
      name: "expanded",
      composition: emptyComposition(),
      defaults: emptySettings(),
      characters: resource.content.characters,
      references: resource.content.references,
    };
    const expanded = applyCharacterPosition(original, resources, resolvedCharacter(), {
      x: 0.7,
      y: 0.8,
    });
    expect(
      expanded.presets[0].binding.kind === "expanded" &&
        expanded.presets[0].binding.characters[0].position,
    ).toEqual({ x: 0.7, y: 0.8 });
    expect(
      expanded.presets[0].binding.kind === "expanded" && expanded.presets[0].binding.references,
    ).toBe(resource.content.references);
  });
  it("does not resurrect a role removed after a resolution or confuse scoped identities", () => {
    const original = creation();
    original.characters = [];
    expect(
      applyCharacterPosition(original, resources, resolvedCharacter("direct", null), {
        x: 0,
        y: 0,
      }),
    ).toBe(original);
    expect(characterKey(resolvedCharacter("a:b", "c"))).not.toBe(
      characterKey(resolvedCharacter("b", "c:a")),
    );
  });
  it("snaps only explicit pointer edits through the supplied SDK grid", () => {
    const point = { x: 0.16, y: 1.2 };
    expect(normalizePosition(point, { min: 0, max: 1 }, [0.2, 0.5, 0.8])).toEqual({
      x: 0.2,
      y: 0.8,
    });
    expect(normalizePosition({ x: 0.123456, y: -0.5 }, { min: 0, max: 1 }, null)).toEqual({
      x: 0.123,
      y: 0,
    });
    expect(point).toEqual({ x: 0.16, y: 1.2 });
  });
});

describe("SDK output field ownership", () => {
  const preview = (): ResolvedDraft => ({
    positive: "base",
    negative: "",
    promptAnalysis: [],
    fragments: [],
    settings: {} as ResolvedDraft["settings"],
    provenance: {} as ResolvedDraft["provenance"],
    issues: [],
    characters: [{ ...resolvedCharacter("direct", null), enabled: false }, resolvedCharacter()],
    inputs: {
      requestCount: 1,
      operation: { kind: "textToImage" },
      stream: null,
      policy: "normalize",
      references: {
        ...emptyReferences(),
        precise: [
          {
            id: outputIdentity(null, "disabled"),
            assetId: "missing",
            enabled: false,
            referenceType: "style",
            strength: 1,
            fidelity: 1,
            informationExtracted: 1,
          },
          {
            id: outputIdentity("first:instance", "ref:local"),
            assetId: "image",
            enabled: true,
            referenceType: "character",
            strength: 1,
            fidelity: 1,
            informationExtracted: 1,
          },
        ],
      },
    },
    inputSources: [
      {
        id: outputIdentity("first:instance", "ref:local"),
        presetInstanceId: "first:instance",
        resourceId: "resource",
        expanded: false,
        overridden: false,
      },
    ],
  });

  it("maps character indices before disabled filtering and precise indices after it", () => {
    expect(
      outputTarget("characters.characters[1].position.x", preview(), creation(), resources),
    ).toEqual({
      kind: "character",
      id: "role:with:colons",
      presetInstanceId: "first:instance",
      field: "x",
    });
    expect(
      outputTarget(
        "references.character_references[0].information_extracted",
        preview(),
        creation(),
        resources,
      ),
    ).toEqual({
      kind: "reference",
      id: "ref:local",
      presetInstanceId: "first:instance",
      field: "informationExtracted",
    });
  });
  it("groups diagnostics under the original identity in the correct instance", () => {
    const issues = collectOutputIssues(
      creation(),
      resources,
      preview(),
      [
        {
          field: "characters.characters[1].position.x",
          change: { kind: "external", detail: "snapped" },
        },
      ],
      ["references.character_references[0].fidelity"],
    );
    expect(issues.presets["first:instance"].characters["role:with:colons"]).toEqual([
      { field: "x", message: "snapped" },
    ]);
    expect(issues.presets["first:instance"].precise["ref:local"][0].field).toBe("fidelity");
    expect(issues.presets.second).toBeUndefined();
  });
  it("locates Vibe fields after disabled filtering and before model-path normalization", () => {
    const draft = creation();
    draft.inputs.references.vibes = [
      {
        id: "disabled-vibe",
        enabled: false,
        input: { kind: "encoded", assetId: "first" },
        strength: 1,
      },
      {
        id: "vibe:local",
        enabled: true,
        input: { kind: "image", assetId: "raw", informationExtracted: 0.7 },
        strength: -1,
      },
    ];
    const resolved = preview();
    resolved.inputs.references.vibes = draft.inputs.references.vibes.map((reference) => ({
      ...reference,
      id: outputIdentity(null, reference.id),
    }));
    expect(
      outputTarget(
        "references.vibe_transfer.references[0].input.information_extracted",
        resolved,
        draft,
        resources,
      ),
    ).toEqual({
      kind: "vibe",
      id: "vibe:local",
      presetInstanceId: null,
      field: "informationExtracted",
    });
    expect(
      collectOutputIssues(
        draft,
        resources,
        resolved,
        [
          {
            field: "references.vibe_transfer.references[0].strength",
            change: { kind: "external", detail: "normalized" },
          },
        ],
        [],
      ).draft.vibes["vibe:local"],
    ).toEqual([{ field: "strength", message: "normalized" }]);
  });
  it("maps direct reference identities independently from identically concatenated preset IDs", () => {
    const draft = creation();
    const resolved = preview();
    const direct = { ...resolved.inputs.references.precise[1], id: "first:instance:ref:local" };
    draft.inputs.references.precise = [direct];
    resolved.inputs.references.precise = [
      { ...direct, id: outputIdentity(null, direct.id) },
      resolved.inputs.references.precise[1],
    ];
    resolved.inputSources.push({
      id: outputIdentity(null, direct.id),
      presetInstanceId: null,
      resourceId: null,
      expanded: false,
      overridden: false,
    });
    expect(
      outputTarget("references.character_references[0].strength", resolved, draft, resources),
    ).toEqual({ kind: "reference", id: direct.id, presetInstanceId: null, field: "strength" });
    expect(
      outputTarget("references.character_references[1].strength", resolved, draft, resources),
    ).toEqual({
      kind: "reference",
      id: "ref:local",
      presetInstanceId: "first:instance",
      field: "strength",
    });
  });
});

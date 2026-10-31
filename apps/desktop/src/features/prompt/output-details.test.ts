import { describe, expect, it } from "vitest";
import type { CharacterComposition, Draft, ResolutionIssue, Resource } from "@/bindings/workbench";
import { emptyComposition, emptyReferences, emptySettings } from "./model";
import { resolutionIssueDetails, tokenFieldLabel } from "./output-details";

const character: CharacterComposition = {
  id: "original:character:identity",
  enabled: true,
  position: { x: 0.5, y: 0.5 },
  composition: {
    positive: [
      {
        kind: "chunk",
        id: "character-node",
        enabled: true,
        resourceId: "missing-chunk",
        overrideText: null,
      },
    ],
    negative: [],
  },
};

const draft = (): Draft => ({
  vibeEncoder: null,
  director: { selectedTool: "lineart", tools: [] },
  pngTextEditor: { sessions: [] },
  promptEditor: { collapsedBlocks: {} },
  activePage: "create",
  revision: 0,
  composition: emptyComposition(),
  settings: emptySettings(),
  presets: [],
  characters: [character],
  inputs: {
    requestCount: 1,
    operation: { kind: "textToImage" },
    policy: "normalize",
    stream: null,
    references: emptyReferences(),
  },
  maskEditor: { activeSourceId: null, sessions: [] },
});

const issue: ResolutionIssue = {
  kind: "missingResource",
  characterId: character.id,
  scope: "positive",
  nodeId: "character-node",
  presetInstanceId: null,
  resourceId: "missing-chunk",
  message: { kind: "external", detail: "Missing resource" },
};

describe("resolved output details", () => {
  it("labels SDK character token fields without exposing protocol paths", () => {
    expect(tokenFieldLabel("characters[0].prompt")).toContain("1");
    expect(tokenFieldLabel("characters[3].negativePrompt")).toContain("4");
    expect(tokenFieldLabel("characters[0].prompt")).not.toContain("characters[");
    expect(tokenFieldLabel("prompt")).not.toBe(tokenFieldLabel("negativePrompt"));
  });

  it("finds a draft character's own composition by its exact original identity", () => {
    const details = resolutionIssueDetails(issue, draft(), new Map());
    expect(details.label).not.toContain(character.id);
    expect(JSON.parse(details.target!.slice("character:".length))).toEqual({
      id: character.id,
      presetInstanceId: null,
      scope: "positive",
      nodeId: "character-node",
    });
  });

  it("finds a linked preset character instead of the base or current draft composition", () => {
    const value = draft();
    value.presets = [
      {
        id: "instance:identity",
        enabled: true,
        binding: {
          kind: "linked",
          resourceId: "preset",
          overrides: [],
          settingsOverrides: emptySettings(),
          outputOverrides: { characters: [], precise: [], vibes: [], normalizeVibeStrength: null },
        },
      },
    ];
    const resource: Resource = {
      id: "preset",
      name: "Source preset",
      revision: 1,
      content: {
        kind: "preset",
        composition: emptyComposition(),
        defaults: emptySettings(),
        characters: [{ ...character, id: "other" }, character],
        references: emptyReferences(),
      },
    };
    const details = resolutionIssueDetails(
      { ...issue, presetInstanceId: "instance:identity" },
      value,
      new Map([[resource.id, resource]]),
    );
    expect(details.label).toContain("Source preset");
    expect(JSON.parse(details.target!.slice("character:".length)).id).toBe(character.id);
  });

  it("finds an expanded preset character without a source resource", () => {
    const value = draft();
    value.presets = [
      {
        id: "expanded",
        enabled: true,
        binding: {
          kind: "expanded",
          name: "Detached",
          composition: emptyComposition(),
          defaults: emptySettings(),
          characters: [character],
          references: emptyReferences(),
        },
      },
    ];
    expect(
      resolutionIssueDetails({ ...issue, presetInstanceId: "expanded" }, value, new Map()).label,
    ).toContain("Detached");
  });

  it("retains a missing character override's original target for issue navigation", () => {
    const value = draft();
    value.characters = [];
    const details = resolutionIssueDetails(
      { ...issue, kind: "staleOverride", scope: null, nodeId: character.id },
      value,
      new Map(),
    );
    expect(JSON.parse(details.target!.slice("character:".length)).id).toBe(character.id);
  });

  it("targets a removed precise reference override without describing it as a prompt fragment", () => {
    const value = draft();
    value.presets = [
      {
        id: "linked",
        enabled: true,
        binding: {
          kind: "linked",
          resourceId: "missing-preset",
          overrides: [],
          settingsOverrides: emptySettings(),
          outputOverrides: {
            characters: [],
            vibes: [],
            normalizeVibeStrength: null,
            precise: [
              {
                id: "original:reference",
                enabled: false,
                assetId: null,
                referenceType: null,
                strength: null,
                fidelity: null,
                informationExtracted: null,
              },
            ],
          },
        },
      },
    ];
    const details = resolutionIssueDetails(
      {
        ...issue,
        kind: "staleOverride",
        characterId: null,
        scope: null,
        nodeId: "original:reference",
        presetInstanceId: "linked",
      },
      value,
      new Map(),
    );
    expect(JSON.parse(details.target!.slice("reference:".length))).toEqual({
      id: "original:reference",
      presetInstanceId: "linked",
    });
  });
});

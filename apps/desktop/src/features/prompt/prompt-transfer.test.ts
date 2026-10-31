import { describe, expect, it } from "vitest";
import type { PromptNode } from "@/bindings/workbench";
import { emptyComposition, emptyReferences, emptySettings, textNode } from "./model";
import { transferPromptNode, type PromptContent, type PromptTarget } from "./prompt-transfer";

const main: PromptTarget = { path: [], scope: "positive" };
const character: PromptTarget = { path: ["character", "person"], scope: "negative" };

function content(nodes: PromptNode[]): PromptContent {
  return {
    composition: { positive: nodes, negative: [] },
    characters: [
      {
        id: "person",
        enabled: true,
        position: { x: 0.5, y: 0.5 },
        composition: emptyComposition(),
      },
    ],
  };
}

describe("prompt transfers", () => {
  it("moves a reference into an empty character scope without changing its overrides", () => {
    const node: PromptNode = {
      kind: "chunk",
      id: "reference",
      resourceId: "resource",
      enabled: false,
      overrideText: "local text",
    };
    const original = content([node]);
    const result = transferPromptNode(original, main, character, node.id)!;
    expect(result.composition.positive).toEqual([]);
    expect(result.characters[0].composition.negative).toEqual([node]);
    expect(original.composition.positive).toEqual([node]);
  });

  it("moves character text back to the main prompt before an existing node", () => {
    const first = textNode("existing");
    const moving = textNode("character text");
    const original = content([first]);
    original.characters[0].composition.negative = [moving];
    const result = transferPromptNode(original, character, main, moving.id, first.id)!;
    expect(result.composition.positive.map((node) => node.id)).toEqual([moving.id, first.id]);
    expect(result.characters[0].composition.negative).toEqual([]);
  });

  it("reorders within a scope in either direction and appends at the end", () => {
    const a = textNode("a"),
      b = textNode("b"),
      c = textNode("c");
    const original = content([a, b, c]);
    const forward = transferPromptNode(original, main, main, a.id, c.id)!;
    expect(forward.composition.positive.map((node) => node.id)).toEqual([b.id, a.id, c.id]);
    const backward = transferPromptNode(original, main, main, c.id, a.id)!;
    expect(backward.composition.positive.map((node) => node.id)).toEqual([c.id, a.id, b.id]);
    const end = transferPromptNode(original, main, main, a.id)!;
    expect(end.composition.positive.map((node) => node.id)).toEqual([b.id, c.id, a.id]);
  });

  it("moves between two characters", () => {
    const node = textNode("moving");
    const original = content([]);
    original.characters[0].composition.negative = [node];
    original.characters.push({
      ...original.characters[0],
      id: "other",
      composition: emptyComposition(),
    });
    const result = transferPromptNode(
      original,
      character,
      { path: ["character", "other"], scope: "positive" },
      node.id,
    )!;
    expect(result.characters[0].composition.negative).toEqual([]);
    expect(result.characters[1].composition.positive).toEqual([node]);
  });

  it("preserves expanded preset structure and rejects references in its text-only content", () => {
    const node = textNode("moving");
    const reference: PromptNode = {
      kind: "chunk",
      id: "ref",
      resourceId: "source",
      enabled: true,
      overrideText: null,
    };
    const original = content([node, reference]);
    original.presets = [
      {
        id: "preset",
        enabled: true,
        binding: {
          kind: "expanded",
          name: "Expanded",
          composition: emptyComposition(),
          characters: [],
          defaults: emptySettings(),
          references: emptyReferences(),
        },
      },
    ];
    const target: PromptTarget = { path: ["preset", "preset"], scope: "positive" };
    const result = transferPromptNode(original, main, target, node.id)!;
    expect(
      transferPromptNode(result, target, character, node.id)!.characters[0].composition.negative,
    ).toEqual([node]);
    expect(transferPromptNode(original, main, target, reference.id)).toBeNull();
  });

  it("rejects stale sources, missing destinations and stale insertion points", () => {
    const node = textNode("keep");
    const original = content([node]);
    expect(transferPromptNode(original, main, character, "missing")).toBeNull();
    expect(
      transferPromptNode(
        original,
        main,
        { path: ["character", "missing"], scope: "positive" },
        node.id,
      ),
    ).toBeNull();
    expect(transferPromptNode(original, main, character, node.id, "missing")).toBeNull();
    expect(transferPromptNode(original, main, main, node.id, node.id)).toBeNull();
    expect(original.composition.positive).toEqual([node]);
  });
});

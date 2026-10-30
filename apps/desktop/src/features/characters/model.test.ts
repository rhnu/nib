import { describe, expect, it } from "vitest";
import type {
  CharacterComposition,
  CharacterOutputOverride,
  InstanceOverride,
} from "@/bindings/workbench";
import { patchCharacter, setCharacterOverride, setTextOverride, staleTextOverrides } from "./model";

function character(id: string): CharacterComposition {
  return {
    id,
    enabled: true,
    position: { x: 0.5, y: 0.5 },
    composition: {
      positive: [{ kind: "text", id: `${id}:positive`, enabled: true, text: id }],
      negative: [],
    },
  };
}

describe("stable character editing", () => {
  it("targets character identity after reorder while retaining its prompt node identity", () => {
    const a = character("a");
    const b = character("b");
    const next = patchCharacter([b, a], "a", { position: { x: 0.1, y: 0.9 } });
    expect(next.map((item) => item.id)).toEqual(["b", "a"]);
    expect(next[0]).toBe(b);
    expect(next[1].composition).toBe(a.composition);
    expect(next[1].position).toEqual({ x: 0.1, y: 0.9 });
    expect(a.position).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("sparse linked overrides", () => {
  it("preserves explicit false and zero-valued position coordinates", () => {
    const source: CharacterOutputOverride[] = [
      { characterId: "a", enabled: true, position: null },
      { characterId: "b", enabled: false, position: null },
    ];
    const next = setCharacterOverride(source, {
      characterId: "a",
      enabled: false,
      position: { x: 0, y: 0 },
    });
    expect(next).toEqual([
      { characterId: "a", enabled: false, position: { x: 0, y: 0 } },
      { characterId: "b", enabled: false, position: null },
    ]);
    expect(source[0].enabled).toBe(true);
  });
  it("removes only a fully reverted character override", () => {
    const original: CharacterOutputOverride[] = [
      { characterId: "a", enabled: false, position: null },
      { characterId: "b", enabled: null, position: { x: 0.2, y: 0.8 } },
    ];
    expect(
      setCharacterOverride(original, { characterId: "a", enabled: null, position: null }),
    ).toEqual([original[1]]);
  });
  it("retains an intentionally empty prompt and explicit disabled state", () => {
    const next = setTextOverride([], { nodeId: "text", enabled: false, text: "" });
    expect(next).toEqual([{ nodeId: "text", enabled: false, text: "" }]);
    expect(setTextOverride(next, { nodeId: "text", enabled: null, text: null })).toEqual([]);
  });
  it("recognizes nodes from every character scope, including disabled characters", () => {
    const role = { ...character("role"), enabled: false };
    role.composition.negative.push({
      kind: "chunk",
      id: "negative-chunk",
      enabled: false,
      resourceId: "chunk",
      overrideText: null,
    });
    const overrides: InstanceOverride[] = [
      { nodeId: "base", enabled: false, text: null },
      { nodeId: "role:positive", enabled: null, text: "" },
      { nodeId: "negative-chunk", enabled: null, text: "override" },
      { nodeId: "removed", enabled: false, text: null },
    ];
    expect(
      staleTextOverrides(
        { positive: [{ kind: "text", id: "base", enabled: true, text: "base" }], negative: [] },
        [role],
        overrides,
      ),
    ).toEqual([overrides[3]]);
  });
});

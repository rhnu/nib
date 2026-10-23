import { describe, expect, it } from "vitest";
import { applyVibeOverride, patchVibeOverride } from "./model";
import type { VibeReferenceInput } from "../../bindings/workbench";

describe("Vibe instance overrides", () => {
  const original: VibeReferenceInput = {
    id: "source",
    enabled: true,
    input: { kind: "encoded", assetId: "cache" },
    strength: 1,
  };
  it("retains explicit zero strength and disabled state independently of source edits", () => {
    const overrides = patchVibeOverride([], original.id, { enabled: false, strength: 0 });
    expect(applyVibeOverride({ ...original, strength: 3 }, overrides[0])).toMatchObject({
      enabled: false,
      strength: 0,
    });
    expect(original.enabled).toBe(true);
  });
  it("clears one field while preserving other identities, then removes an empty override", () => {
    const first = patchVibeOverride([], "source", { strength: 0 });
    const both = patchVibeOverride(first, "other", { enabled: false });
    expect(patchVibeOverride(both, "source", { strength: null })).toEqual([
      { id: "other", enabled: false, input: null, strength: null },
    ]);
  });
});

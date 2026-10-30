import { describe, expect, it } from "vitest";
import { applyVibeOverride, patchVibeOverride, showVibeReferences } from "./model";
import type { VibeReferenceInput } from "../../bindings/workbench";

describe("Vibe Transfer availability", () => {
  it("shows controls while loading and on supported models without requested materials", () => {
    expect(showVibeReferences(null)).toBe(true);
    expect(
      showVibeReferences({
        canAddVibeReference: true,
        vibeReference: { available: false, reason: "notRequested" },
      }),
    ).toBe(true);
  });
  it("hides unsupported models and operations and conflicts with precise references", () => {
    for (const reason of ["unsupported", "unsupportedMode"]) {
      expect(
        showVibeReferences({
          canAddVibeReference: false,
          vibeReference: { available: false, reason },
        }),
      ).toBe(false);
    }
    expect(
      showVibeReferences({
        canAddVibeReference: true,
        vibeReference: { available: false, reason: "conflictWithPreciseReference" },
      }),
    ).toBe(false);
  });
});

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

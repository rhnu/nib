import { describe, expect, it } from "vitest";
import type { PreciseReferenceInput } from "@/bindings/workbench";
import {
  applyPreciseReferenceOverride,
  emptyPreciseReferenceOverride,
  patchPreciseReference,
  patchPreciseReferenceOverride,
  preciseReferenceMessages,
  showPreciseReferences,
} from "./model";

const reference = (id: string): PreciseReferenceInput => ({
  id,
  enabled: true,
  assetId: `${id}-image`,
  referenceType: "character",
  strength: 0.75,
  fidelity: 0.8,
  informationExtracted: 0.6,
});

describe("precise reference editing", () => {
  it("hides unsupported empty sections while retaining inputs and capability loading", () => {
    expect(showPreciseReferences({ canAddPreciseReference: false }, 0)).toBe(false);
    expect(showPreciseReferences({ canAddPreciseReference: false }, 1)).toBe(true);
    expect(showPreciseReferences({ canAddPreciseReference: true }, 0)).toBe(true);
    expect(showPreciseReferences(null, 0)).toBe(true);
  });
  it("does not report unused groups as ineffective and shows SDK conflicts", () => {
    expect(
      preciseReferenceMessages({
        canAddPreciseReference: true,
        preciseReference: { available: false, reason: "notRequested" },
        vibeReference: { available: false, reason: "notRequested" },
      }),
    ).toEqual({ precise: null, vibe: null });
    expect(
      preciseReferenceMessages({
        canAddPreciseReference: true,
        preciseReference: { available: true, reason: "available" },
        vibeReference: { available: false, reason: "conflictWithPreciseReference" },
      }),
    ).toEqual({ precise: null, vibe: "氛围转移不生效：与启用的精确参考冲突" });
  });

  it("reports unsupported models even before the first reference is requested", () => {
    expect(
      preciseReferenceMessages({
        canAddPreciseReference: false,
        preciseReference: { available: false, reason: "notRequested" },
        vibeReference: { available: false, reason: "notRequested" },
      }).precise,
    ).toBe("当前模型或操作不支持精确参考。");
  });
  it("changes a stable identity after reordering and retains unrelated image parameters", () => {
    const first = reference("first");
    const second = reference("second");
    const values = patchPreciseReference([second, first], "first", { assetId: "replacement" });
    expect(values).toEqual([second, { ...first, assetId: "replacement" }]);
    expect(first.assetId).toBe("first-image");
  });

  it("retains explicit false, zero and negative overrides", () => {
    const original = reference("first");
    const overrides = patchPreciseReferenceOverride([], "first", {
      enabled: false,
      strength: -0.5,
      fidelity: 0,
      informationExtracted: 0,
    });
    expect(applyPreciseReferenceOverride(original, overrides[0])).toEqual({
      ...original,
      enabled: false,
      strength: -0.5,
      fidelity: 0,
      informationExtracted: 0,
    });
  });

  it("reverts one field to the latest source and retains other instance changes", () => {
    const initial = patchPreciseReferenceOverride([], "first", { strength: 0, fidelity: -0.2 });
    const overrides = patchPreciseReferenceOverride(initial, "first", { strength: null });
    const changedSource = { ...reference("first"), strength: 0.4 };
    expect(applyPreciseReferenceOverride(changedSource, overrides[0])).toEqual({
      ...changedSource,
      fidelity: -0.2,
    });
  });

  it("removes a fully reset override without clearing another identity or stale entries", () => {
    const other = { ...emptyPreciseReferenceOverride("other"), enabled: false };
    const initial = patchPreciseReferenceOverride([other], "first", { strength: 0 });
    expect(patchPreciseReferenceOverride(initial, "first", { strength: null })).toEqual([other]);
  });

  it("keeps overrides attached to their identities when source order changes", () => {
    const overrides = patchPreciseReferenceOverride([], "first", { assetId: "local-image" });
    const values = [reference("second"), reference("first")].map((original) =>
      applyPreciseReferenceOverride(
        original,
        overrides.find((item) => item.id === original.id),
      ),
    );
    expect(values[0].assetId).toBe("second-image");
    expect(values[1].assetId).toBe("local-image");
  });
});

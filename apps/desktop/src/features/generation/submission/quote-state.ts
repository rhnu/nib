import type { CreationOperation, Draft } from "@/bindings/workbench";

/** Normalization must not silently switch a requested image operation or drop its conditioning mode. */
export function isOperationEffective(
  requested: CreationOperation,
  effective: CreationOperation | null,
): boolean {
  if (requested.kind === "inpainting")
    return effective?.kind === "inpainting" && (!requested.img2img || effective.img2img !== null);
  return (
    requested.kind !== "imageToImage" ||
    !requested.maxEnhance ||
    (effective?.kind === "imageToImage" && effective.maxEnhance)
  );
}

// A save changes the revision, but not the content or resource versions being estimated.
export function generationQuoteKey(draft: Draft, refreshKey?: unknown): string {
  return JSON.stringify([
    draft.composition,
    draft.presets,
    draft.settings,
    draft.characters,
    draft.inputs,
    refreshKey ?? null,
  ]);
}

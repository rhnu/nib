import type { CreationOperation, Draft, ResolvedDraft } from "../../bindings/workbench";

/** A normalization may adjust fields, but must not silently turn a requested Max operation into ordinary img2img. */
export function isOperationEffective(
  requested: CreationOperation,
  effective: CreationOperation | null,
): boolean {
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

export function hasResolvedPrompt(resolved?: Pick<ResolvedDraft, "positive"> | null): boolean {
  return Boolean(resolved?.positive.trim());
}

export function isQuoteEligible(
  draft: Draft,
  resolved?: Pick<ResolvedDraft, "positive"> | null,
): boolean {
  const operation = draft.inputs.operation.kind;
  return (
    operation === "director" ||
    operation === "encodeVibe" ||
    operation === "upscale" ||
    hasResolvedPrompt(resolved)
  );
}

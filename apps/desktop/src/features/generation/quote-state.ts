import type { Draft, ResolvedDraft } from "../../bindings/workbench";

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
  return operation === "director" || operation === "encodeVibe" || hasResolvedPrompt(resolved);
}

import type { Draft, ResolvedDraft } from "../../bindings/workbench";

// A save changes the revision, but not the content or resource versions being estimated.
export function generationQuoteKey(draft: Draft, refreshKey?: unknown): string {
  return JSON.stringify([draft.composition, draft.presets, draft.settings, refreshKey ?? null]);
}

export function hasResolvedPrompt(resolved?: Pick<ResolvedDraft, "positive"> | null): boolean {
  return Boolean(resolved?.positive.trim());
}

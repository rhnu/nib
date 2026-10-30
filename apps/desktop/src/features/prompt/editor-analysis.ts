import { StateEffect, StateField } from "@codemirror/state";
import type { PromptDocument, PromptSyntaxProfile } from "@/bindings/prompt";

export const setPromptAnalysis = StateEffect.define<PromptDocument | null>();
export const setPromptProfile = StateEffect.define<PromptSyntaxProfile | null>();
export const promptInsertionError = StateEffect.define<unknown>();

/** A formatter must use the exact profile that produced the active source coordinates. */
export const promptProfile = StateField.define<PromptSyntaxProfile | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setPromptProfile)) value = effect.value;
    }
    return value;
  },
});

/** Cursor moves and edits invalidate work even if undo or later navigation restores the same text. */
export const promptRevision = StateField.define<number>({
  create: () => 0,
  update: (revision, transaction) =>
    transaction.docChanged || transaction.selection ? revision + 1 : revision,
});

/** Source changes invalidate all semantic coordinates until their matching analysis arrives. */
export const promptAnalysis = StateField.define<PromptDocument | null>({
  create: () => null,
  update(value, transaction) {
    if (transaction.docChanged) value = null;
    for (const effect of transaction.effects) {
      if (effect.is(setPromptAnalysis)) value = effect.value;
    }
    return value;
  },
});

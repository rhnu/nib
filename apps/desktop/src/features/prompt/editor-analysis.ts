import { StateEffect, StateField } from "@codemirror/state";
import type { PromptDocument } from "@/bindings/prompt";

export const setPromptAnalysis = StateEffect.define<PromptDocument | null>();

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

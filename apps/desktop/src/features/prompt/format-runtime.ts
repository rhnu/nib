import type { LexiconFormatTerm, PromptFormat, PromptSyntaxProfile } from "@/bindings/prompt";
import { t, deferMessage, MessageError } from "@/shared/i18n";

let runtime: Promise<typeof import("@/bindings/prompt-wasm/nib_prompt")> | undefined;

/** Insertion uses the same Rust grammar as analysis, without copying native escaping or weights. */
function loadRuntime() {
  runtime ??= import("@/bindings/prompt-wasm/nib_prompt")
    .then(async (module) => {
      await module.default();
      return module;
    })
    .catch((cause: unknown) => {
      runtime = undefined;
      throw cause;
    });
  return runtime;
}

export async function formatLexiconTerms(terms: LexiconFormatTerm[], profile: PromptSyntaxProfile) {
  return (await loadRuntime()).formatLexiconTerms(terms, profile);
}

/** Existing editable source keeps comments and model syntax; only ordinary whitespace changes. */
export async function formatPrompt(
  text: string,
  profile: PromptSyntaxProfile,
  precedingSources: string[],
): Promise<PromptFormat> {
  try {
    return (await loadRuntime()).formatPrompt(text, profile, precedingSources);
  } catch (cause) {
    if (cause === "ambiguousCommentContext")
      throw new MessageError(deferMessage(() => t("prompt.formatAmbiguousContext")));
    throw cause;
  }
}

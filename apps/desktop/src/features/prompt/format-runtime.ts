import type { LexiconFormatTerm, PromptSyntaxProfile } from "@/bindings/prompt";

let runtime: Promise<typeof import("@/bindings/prompt-wasm/nib_prompt")> | undefined;

/** Insertion uses the same Rust grammar as analysis, without copying native escaping or weights. */
export async function formatLexiconTerms(terms: LexiconFormatTerm[], profile: PromptSyntaxProfile) {
  runtime ??= import("@/bindings/prompt-wasm/nib_prompt")
    .then(async (module) => {
      await module.default();
      return module;
    })
    .catch((cause: unknown) => {
      runtime = undefined;
      throw cause;
    });
  return (await runtime).formatLexiconTerms(terms, profile);
}

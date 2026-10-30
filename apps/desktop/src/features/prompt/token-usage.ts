import type { TokenFieldUsage } from "@/bindings/generation";
import type { ResolvedCharacter } from "@/bindings/workbench";

export type PromptTokenUsage = {
  positive?: TokenFieldUsage;
  negative?: TokenFieldUsage;
};

/** Keep the SDK's independent positive and negative budgets in one display scope. */
export function promptTokenUsage(tokens: TokenFieldUsage[], prefix = ""): PromptTokenUsage {
  return {
    positive: tokens.find((token) => token.field === `${prefix}prompt`),
    negative: tokens.find((token) => token.field === `${prefix}negativePrompt`),
  };
}

/** Request indices belong to the frozen resolution, never the editor's row order. */
export function characterTokenUsage(
  tokens: TokenFieldUsage[],
  characters: readonly Pick<ResolvedCharacter, "id">[],
): Map<string, PromptTokenUsage> {
  return new Map(
    characters.map((character, index) => [
      character.id,
      promptTokenUsage(tokens, `characters[${index}].`),
    ]),
  );
}

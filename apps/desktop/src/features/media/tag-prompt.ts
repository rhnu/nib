import type { Draft, Resource } from "@/bindings/workbench";
import { t } from "@/shared/i18n";
import { textNode } from "@/features/prompt/model";

export type TagPromptTarget = {
  key: string;
  label: string;
  characterId?: string;
  presetId?: string;
  linked?: boolean;
};

/** Target identities retain the preset scope, even when two presets share character IDs. */
export function tagPromptTargets(
  draft: Pick<Draft, "composition" | "characters" | "presets">,
  resources: Map<string, Resource>,
): TagPromptTarget[] {
  return [
    { key: "main", label: t("safety.mainPrompt") },
    ...draft.characters.map((character, index) => ({
      key: JSON.stringify([null, character.id]),
      characterId: character.id,
      label: t("safety.characterPrompt", { index: index + 1 }),
    })),
    ...draft.presets.flatMap((preset) => {
      const binding = preset.binding;
      const resource = binding.kind === "linked" ? resources.get(binding.resourceId) : null;
      const content = binding.kind === "expanded" ? binding : resource?.content;
      if (!content || !("characters" in content)) return [];
      const characters = content.characters;
      return characters.map((character, index) => ({
        key: JSON.stringify([preset.id, character.id]),
        characterId: character.id,
        presetId: preset.id,
        linked: binding.kind === "linked",
        label: t("safety.presetCharacterPrompt", {
          name: binding.kind === "expanded" ? binding.name : resource!.name,
          index: index + 1,
        }),
      }));
    }),
  ];
}

/** Append an independent fragment so existing prompt grammar and resource bindings stay intact. */
export function appendRecognizedTags<
  T extends Pick<Draft, "composition" | "characters" | "presets">,
>(draft: T, target: TagPromptTarget, text: string): T | null {
  const node = textNode(text);
  if (target.key === "main")
    return {
      ...draft,
      composition: { ...draft.composition, positive: [...draft.composition.positive, node] },
    };

  const append = (character: Draft["characters"][number]) => ({
    ...character,
    composition: { ...character.composition, positive: [...character.composition.positive, node] },
  });

  if (!target.presetId) {
    if (!draft.characters.some((character) => character.id === target.characterId)) return null;
    return {
      ...draft,
      characters: draft.characters.map((character) =>
        character.id === target.characterId ? append(character) : character,
      ),
    };
  }
  const preset = draft.presets.find((item) => item.id === target.presetId);
  if (
    preset?.binding.kind !== "expanded" ||
    !preset.binding.characters.some((character) => character.id === target.characterId)
  )
    return null;
  return {
    ...draft,
    presets: draft.presets.map((item) =>
      item.id === preset.id && item.binding.kind === "expanded"
        ? {
            ...item,
            binding: {
              ...item.binding,
              characters: item.binding.characters.map((character) =>
                character.id === target.characterId ? append(character) : character,
              ),
            },
          }
        : item,
    ),
  };
}

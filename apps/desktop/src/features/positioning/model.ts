import type {
  CharacterComposition,
  Draft,
  Resource,
  ResolvedCharacter,
} from "@/bindings/workbench";
import { outputIdentity } from "@/features/prompt/output-identity";

export type Position = CharacterComposition["position"];

export function characterKey(
  character: Pick<ResolvedCharacter, "id" | "presetInstanceId">,
): string {
  return JSON.stringify([character.presetInstanceId, character.id]);
}

/** Match exact scoped identities; resource and character IDs can themselves contain colons. */
export function characterDefinition(
  draft: Draft,
  resources: Map<string, Resource>,
  character: ResolvedCharacter,
) {
  if (!character.presetInstanceId)
    return draft.characters.find((item) => outputIdentity(null, item.id) === character.id) ?? null;
  const instance = draft.presets.find((item) => item.id === character.presetInstanceId);
  if (!instance) return null;
  const binding = instance.binding;
  const resource = binding.kind === "linked" ? resources.get(binding.resourceId) : null;
  const characters =
    binding.kind === "expanded"
      ? binding.characters
      : resource?.content.kind === "preset"
        ? resource.content.characters
        : [];
  return characters.find((item) => outputIdentity(instance.id, item.id) === character.id) ?? null;
}

/** Overlay live editor fields so an asynchronous text resolution never pulls a dragged marker backwards. */
export function livePositionCharacters(
  draft: Draft,
  resources: Map<string, Resource>,
  resolved: ResolvedCharacter[],
): ResolvedCharacter[] {
  return resolved.flatMap((character) => {
    const original = characterDefinition(draft, resources, character);
    if (!original) return [];
    const instance = draft.presets.find((item) => item.id === character.presetInstanceId);
    const override =
      instance?.binding.kind === "linked"
        ? instance.binding.outputOverrides.characters.find(
            (item) => item.characterId === original.id,
          )
        : null;
    return [
      {
        ...character,
        enabled: (instance?.enabled ?? true) && (override?.enabled ?? original.enabled),
        position: override?.position ?? original.position,
      },
    ];
  });
}

/** Update only the selected role's owning definition or local output override. */
export function applyCharacterPosition(
  draft: Draft,
  resources: Map<string, Resource>,
  character: ResolvedCharacter,
  position: Position,
): Draft {
  const original = characterDefinition(draft, resources, character);
  if (!original) return draft;
  if (!character.presetInstanceId)
    return {
      ...draft,
      settings: { ...draft.settings, useCoords: true },
      characters: draft.characters.map((item) =>
        item.id === original.id ? { ...item, position } : item,
      ),
    };
  return {
    ...draft,
    settings: { ...draft.settings, useCoords: true },
    presets: draft.presets.map((instance) => {
      if (instance.id !== character.presetInstanceId) return instance;
      const binding = instance.binding;
      if (binding.kind === "expanded")
        return {
          ...instance,
          binding: {
            ...binding,
            characters: binding.characters.map((item) =>
              item.id === original.id ? { ...item, position } : item,
            ),
          },
        };
      const previous = binding.outputOverrides.characters.find(
        (item) => item.characterId === original.id,
      );
      const override = { characterId: original.id, enabled: previous?.enabled ?? null, position };
      return {
        ...instance,
        binding: {
          ...binding,
          outputOverrides: {
            ...binding.outputOverrides,
            characters: [
              ...binding.outputOverrides.characters.filter(
                (item) => item.characterId !== original.id,
              ),
              override,
            ],
          },
        },
      };
    }),
  };
}

export function normalizePosition(
  point: Position,
  range: { min: number; max: number },
  grid: number[] | null,
): Position {
  const coordinate = (value: number) => {
    const clamped = Math.min(range.max, Math.max(range.min, value));
    return grid?.length
      ? grid.reduce((best, candidate) =>
          Math.abs(candidate - clamped) < Math.abs(best - clamped) ? candidate : best,
        )
      : Math.round(clamped * 1000) / 1000;
  };
  return { x: coordinate(point.x), y: coordinate(point.y) };
}

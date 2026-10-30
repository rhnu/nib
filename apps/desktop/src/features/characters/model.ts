import type {
  CharacterComposition,
  CharacterOutputOverride,
  Composition,
  InstanceOverride,
} from "@/bindings/workbench";
import { emptyComposition, textNode } from "@/features/prompt/model";

export type CharacterFieldIssue = { field: string; message: string };
export type CharacterIssues = Record<string, CharacterFieldIssue[]>;

export function createCharacter(position: CharacterComposition["position"]): CharacterComposition {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    position: { ...position },
    composition: { ...emptyComposition(), positive: [textNode()] },
  };
}

export function patchCharacter(
  value: CharacterComposition[],
  id: string,
  patch: Partial<Omit<CharacterComposition, "id">>,
): CharacterComposition[] {
  return value.map((character) => (character.id === id ? { ...character, ...patch } : character));
}

export function setCharacterOverride(
  value: CharacterOutputOverride[],
  next: CharacterOutputOverride,
): CharacterOutputOverride[] {
  const keep = next.enabled !== null || next.position !== null;
  const found = value.some((item) => item.characterId === next.characterId);
  const result = value.flatMap((item) =>
    item.characterId === next.characterId ? (keep ? [next] : []) : [item],
  );
  return keep && !found ? [...result, next] : result;
}

export function setTextOverride(
  value: InstanceOverride[],
  next: InstanceOverride,
): InstanceOverride[] {
  const keep = next.enabled !== null || next.text !== null;
  const found = value.some((item) => item.nodeId === next.nodeId);
  const result = value.flatMap((item) =>
    item.nodeId === next.nodeId ? (keep ? [next] : []) : [item],
  );
  return keep && !found ? [...result, next] : result;
}

/** Instance text overrides share stable node identity across base and all character scopes. */
export function staleTextOverrides(
  base: Composition,
  characters: CharacterComposition[],
  overrides: InstanceOverride[],
): InstanceOverride[] {
  const compositions = [base, ...characters.map((character) => character.composition)];
  const ids = new Set(
    compositions.flatMap((composition) =>
      [...composition.positive, ...composition.negative].map((node) => node.id),
    ),
  );
  return overrides.filter((item) => !ids.has(item.nodeId));
}

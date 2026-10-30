import type { Composition, Draft, Resource } from "@/bindings/workbench";

function compositionIds(value: Composition): string[] {
  return [...value.positive, ...value.negative].flatMap((node) =>
    node.kind === "chunk" ? [node.resourceId] : [],
  );
}

export function resourceDependencies(resource: Resource): string[] {
  return resource.content.kind === "chunk"
    ? []
    : [
        ...compositionIds(resource.content.composition),
        ...resource.content.characters.flatMap((character) =>
          compositionIds(character.composition),
        ),
      ];
}

export function draftResourceIds(draft: Draft): string[] {
  return [
    ...new Set([
      ...compositionIds(draft.composition),
      ...draft.characters.flatMap((character) => compositionIds(character.composition)),
      ...draft.presets.flatMap(({ binding }) =>
        binding.kind === "linked"
          ? [binding.resourceId]
          : [
              ...compositionIds(binding.composition),
              ...binding.characters.flatMap((character) => compositionIds(character.composition)),
            ],
      ),
    ]),
  ].sort();
}

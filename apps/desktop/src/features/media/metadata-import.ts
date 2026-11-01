import type {
  CharacterComposition,
  Composition,
  Draft,
  GenerationSettings,
  Resource,
} from "@/bindings/workbench";

export type MetadataImportMode = "append" | "replace";

export type MetadataSelection = {
  prompt: boolean;
  negativePrompt: boolean;
  characters: boolean;
  settings: boolean;
  seed: boolean;
};

/** Follow the same preset-first role order as the workbench, including disabled roles. */
export function metadataCharacterTargets(current: Draft, resources: Map<string, Resource>) {
  return [
    ...current.presets.flatMap((preset) => {
      const binding = preset.binding;
      const content =
        binding.kind === "expanded" ? binding : resources.get(binding.resourceId)?.content;
      return content && "characters" in content
        ? content.characters.map((character) => ({
            character,
            presetId: preset.id,
            linked: binding.kind === "linked",
          }))
        : [];
    }),
    ...current.characters.map((character) => ({ character, presetId: null, linked: false })),
  ];
}

function importedComposition(source: Composition): Composition {
  const nodes = (values: Composition["positive"]) =>
    values
      .filter((node) => node.kind !== "text" || node.text !== "")
      .map((node) => ({ ...node, id: crypto.randomUUID() }));

  return { positive: nodes(source.positive), negative: nodes(source.negative) };
}

function appendComposition(current: Composition, source: Composition): Composition {
  return {
    positive: [...current.positive, ...source.positive],
    negative: [...current.negative, ...source.negative],
  };
}

/** Apply selected fields to the latest draft after targeted linked role instances are expanded. */
export function applyMetadataImport(
  current: Draft,
  source: Draft,
  selection: MetadataSelection,
  mode: MetadataImportMode = "append",
  resources: Map<string, Resource> = new Map(),
): Draft {
  const settings = { ...current.settings };
  if (selection.settings) {
    for (const key of Object.keys(source.settings) as (keyof GenerationSettings)[]) {
      if (key === "seed" || key === "quality" || key === "ucPreset") continue;
      const value = source.settings[key];
      if (value !== null) Object.assign(settings, { [key]: value });
    }
  }
  if (selection.seed && source.settings.seed !== null) settings.seed = source.settings.seed;
  // Recorded prompts already contain automatic tags; importing text must not add those twice.
  if (selection.prompt) settings.quality = source.settings.quality;
  if (selection.negativePrompt) settings.ucPreset = source.settings.ucPreset;
  const composition = importedComposition(source.composition);
  let characters = current.characters;
  let presets = current.presets;
  if (selection.characters) {
    const incoming = source.characters.map((character) => ({
      ...character,
      id: crypto.randomUUID(),
      composition: importedComposition(character.composition),
    }));
    if (mode === "replace") characters = incoming;
    else {
      const targets = metadataCharacterTargets(current, resources);
      const changes = incoming.map((character, index) => ({ character, target: targets[index] }));

      const append = (character: CharacterComposition, presetId: string | null) => {
        const change = changes.find(
          (value) =>
            value.target?.presetId === presetId && value.target.character.id === character.id,
        );
        return change
          ? {
              ...character,
              composition: appendComposition(character.composition, change.character.composition),
            }
          : character;
      };

      characters = [
        ...current.characters.map((character) => append(character, null)),
        ...changes.filter((change) => !change.target).map((change) => change.character),
      ];
      presets = current.presets.map((preset) =>
        preset.binding.kind === "expanded"
          ? {
              ...preset,
              binding: {
                ...preset.binding,
                characters: preset.binding.characters.map((character) =>
                  append(character, preset.id),
                ),
              },
            }
          : preset,
      );
    }
  }
  return {
    ...current,
    composition: {
      positive: selection.prompt
        ? mode === "append"
          ? [...current.composition.positive, ...composition.positive]
          : composition.positive
        : current.composition.positive,
      negative: selection.negativePrompt
        ? mode === "append"
          ? [...current.composition.negative, ...composition.negative]
          : composition.negative
        : current.composition.negative,
    },
    characters,
    presets,
    settings,
  };
}

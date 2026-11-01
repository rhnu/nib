import type { Composition, GenerationSettings, PromptNode } from "@/bindings/workbench";

export const emptySettings = (): GenerationSettings => ({
  model: null,
  size: null,
  steps: null,
  scale: null,
  sampler: null,
  seed: null,
  nSamples: null,
  quality: null,
  ucPreset: null,
  legacyUc: null,
  transparentBackground: null,
  furryMode: null,
  noiseSchedule: null,
  cfgRescale: null,
  varietyBoost: null,
  decrisp: null,
  smea: null,
  smeaDyn: null,
  imageFormat: null,
  alphaMode: null,
  responseFormat: null,
  useCoords: null,
});
export const emptyReferences = () => ({ precise: [], vibes: [], normalizeVibeStrength: null });
export const emptyComposition = (): Composition => ({ positive: [], negative: [] });
export const textNode = (text = ""): PromptNode => ({
  kind: "text",
  id: crypto.randomUUID(),
  enabled: true,
  text,
});

/** Move an item to its offset position, keeping the other items in order. */
export function moveItem<T>(items: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length || offset === 0)
    return items;
  const copy = [...items];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
}

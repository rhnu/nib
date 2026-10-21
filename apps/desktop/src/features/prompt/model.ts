import type { Composition, GenerationSettings, PromptNode } from "../../bindings/workbench";

export const emptySettings = (): GenerationSettings => ({
  model: null,
  size: null,
  steps: null,
  scale: null,
  sampler: null,
});
export const emptyComposition = (): Composition => ({ positive: [], negative: [] });
export const textNode = (): PromptNode => ({
  kind: "text",
  id: crypto.randomUUID(),
  enabled: true,
  text: "",
});

export function moveItem<T>(items: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const copy = [...items];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

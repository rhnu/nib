import type {
  CharacterComposition,
  Composition,
  PresetInstance,
  PromptNode,
  PromptScope,
} from "@/bindings/workbench";

export type PromptTarget = { path: readonly string[]; scope: PromptScope };
export type PromptContent = {
  composition: Composition;
  characters: CharacterComposition[];
  presets?: PresetInstance[];
};

function compositionAt(content: PromptContent, path: readonly string[]): Composition | undefined {
  if (!path.length) return content.composition;
  if (path[0] === "character" && path.length === 2)
    return content.characters.find((item) => item.id === path[1])?.composition;
  if (path[0] === "preset") {
    const binding = content.presets?.find((item) => item.id === path[1])?.binding;
    if (binding?.kind === "expanded") return compositionAt(binding, path.slice(2));
  }
}

function replaceComposition(
  content: PromptContent,
  path: readonly string[],
  composition: Composition,
): PromptContent {
  if (!path.length) return { ...content, composition };
  if (path[0] === "character")
    return {
      ...content,
      characters: content.characters.map((item) =>
        item.id === path[1] ? { ...item, composition } : item,
      ),
    };
  return {
    ...content,
    presets: content.presets?.map((item) => {
      if (item.id !== path[1] || item.binding.kind !== "expanded") return item;
      const next = replaceComposition(item.binding, path.slice(2), composition);
      return {
        ...item,
        binding: { ...item.binding, composition: next.composition, characters: next.characters },
      };
    }),
  };
}

/** Move the original node in one content update, including references and explicit disabled state. */
export function transferPromptNode<T extends PromptContent>(
  content: T,
  from: PromptTarget,
  to: PromptTarget,
  nodeId: string,
  beforeId?: string,
): T | null {
  const source = compositionAt(content, from.path);
  const target = compositionAt(content, to.path);
  const node = source?.[from.scope].find((item) => item.id === nodeId);
  if (!source || !target || !node || beforeId === nodeId) return null;
  // Expanded presets contain independent text only, as required by their domain contract.
  if (to.path[0] === "preset" && node.kind === "chunk") return null;
  if (beforeId && !target[to.scope].some((item) => item.id === beforeId)) return null;
  const removed = replaceComposition(content, from.path, {
    ...source,
    [from.scope]: source[from.scope].filter((item) => item.id !== nodeId),
  });
  const destination = compositionAt(removed, to.path)!;
  const nodes: PromptNode[] = [...destination[to.scope]];
  nodes.splice(beforeId ? nodes.findIndex((item) => item.id === beforeId) : nodes.length, 0, node);
  return replaceComposition(removed, to.path, { ...destination, [to.scope]: nodes }) as T;
}

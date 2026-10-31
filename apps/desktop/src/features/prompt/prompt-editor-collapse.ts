import type { PromptEditorState } from "@/bindings/workbench";

/** Scope paths distinguish reused resource nodes without parsing their IDs. */
export function promptBlockKey(path: readonly string[], nodeId: string): string {
  return JSON.stringify([...path, nodeId]);
}

/** Explicit expansion is retained even when a fragment starts collapsed. */
export function promptBlockCollapsed(
  state: PromptEditorState,
  key: string,
  defaultCollapsed: boolean,
): boolean {
  return state.collapsedBlocks[key] ?? defaultCollapsed;
}

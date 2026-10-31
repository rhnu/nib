import { createContext, useContext, useState, type ReactNode } from "react";
import type { PromptEditorState } from "@/bindings/workbench";
import { promptBlockCollapsed, promptBlockKey } from "./prompt-editor-collapse";

type PromptEditorController = {
  state: PromptEditorState;
  onCollapsedChange: (key: string, collapsed: boolean) => void;
};

const PromptEditorContext = createContext<PromptEditorController | null>(null);
const PromptEditorScopeContext = createContext<readonly string[]>([]);

/** The generation page owns persisted presentation state separately from prompt content. */
export function PromptEditorStateProvider({
  state,
  onCollapsedChange,
  children,
}: PromptEditorController & { children: ReactNode }) {
  return (
    <PromptEditorContext.Provider value={{ state, onCollapsedChange }}>
      {children}
    </PromptEditorContext.Provider>
  );
}

/** Nested compositions append their instance and character identities to the current path. */
export function PromptEditorScope({
  path,
  children,
}: {
  path: readonly string[];
  children: ReactNode;
}) {
  const parent = useContext(PromptEditorScopeContext);
  return (
    <PromptEditorScopeContext.Provider value={[...parent, ...path]}>
      {children}
    </PromptEditorScopeContext.Provider>
  );
}

/** Resource editors without a draft provider keep their collapse state local. */
export function usePromptBlockCollapse(nodeId: string, defaultCollapsed: boolean) {
  const controller = useContext(PromptEditorContext);
  const path = useContext(PromptEditorScopeContext);
  const [localCollapsed, setLocalCollapsed] = useState(defaultCollapsed);
  const key = promptBlockKey(path, nodeId);
  const collapsed = controller
    ? promptBlockCollapsed(controller.state, key, defaultCollapsed)
    : localCollapsed;

  const setCollapsed = (next: boolean) => {
    if (controller) controller.onCollapsedChange(key, next);
    else setLocalCollapsed(next);
  };

  return [collapsed, setCollapsed] as const;
}

/** Current composition address also identifies drag destinations. */
export function usePromptEditorPath() {
  return useContext(PromptEditorScopeContext);
}

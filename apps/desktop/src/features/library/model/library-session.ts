import { createStore } from "zustand/vanilla";
import type { Resource, ResourceKind } from "@/bindings/workbench";
import { mergeResourceSave } from "../resource-edit";

export type LibrarySessionState = {
  query: string;
  kind: ResourceKind | "";
  editor: Resource | null;
  dirty: boolean;
  busy: boolean;
  version: number;
  operation: number;
  error: unknown;
  confirm: { title: unknown; action: () => void } | null;
};

/** Own library edits and search context for the lifetime of one open workbench. */
export function createLibrarySessionStore() {
  return createStore<LibrarySessionState>(() => ({
    query: "",
    kind: "",
    editor: null,
    dirty: false,
    busy: false,
    version: 0,
    operation: 0,
    error: "",
    confirm: null,
  }));
}

export type LibrarySessionStore = ReturnType<typeof createLibrarySessionStore>;

/** Keep the host revision when replacing a resource's editable content. */
export function editLibraryResource(store: LibrarySessionStore, resource: Resource) {
  const current = store.getState();
  if (!current.editor || resource.id !== current.editor.id) return;
  store.setState({
    version: current.version + 1,
    editor: { ...resource, revision: current.editor.revision },
    dirty: true,
  });
}

/** Apply an acknowledgement to whichever edit is current when the save finishes. */
export function acceptLibrarySave(
  store: LibrarySessionStore,
  request: { id: string; version: number },
  saved: Resource,
) {
  const current = store.getState();
  const merged = mergeResourceSave(current.editor, current.version, request, saved);
  if (merged) store.setState(merged);
}

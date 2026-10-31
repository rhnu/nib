import { createStore } from "zustand/vanilla";
import type {
  Resource,
  ResourceKind,
  ResourceSaveMode,
  ResourceSelection,
  ResourceSort,
} from "@/bindings/workbench";
import { mergeResourceSave } from "../resource-edit";

export type LibrarySessionState = {
  sort: ResourceSort;
  descending: boolean;
  query: string;
  kind: ResourceKind | "";
  folderId: string | null;
  rootOnly: boolean;
  includeSubfolders: boolean;
  model: string;
  tag: string;
  offset: number;
  view: "grid" | "list";
  selectedIds: string[];
  inspector: boolean;
  clipboard: { selection: ResourceSelection; cut: boolean } | null;
  pendingCoverIds: string[];
  collapsedFolders: string[];
  editor: Resource | null;
  saveMode: ResourceSaveMode;
  dirty: boolean;
  busy: boolean;
  version: number;
  operation: number;
  error: unknown;
  confirm: { title: unknown; action: () => void } | null;
};

/** Own resource edits and browsing context for the lifetime of one workbench. */
export function createLibrarySessionStore() {
  return createStore<LibrarySessionState>(() => ({
    sort: "name",
    descending: false,
    query: "",
    kind: "",
    folderId: null,
    rootOnly: false,
    includeSubfolders: true,
    model: "",
    tag: "",
    offset: 0,
    view: "grid",
    selectedIds: [],
    inspector: true,
    clipboard: null,
    pendingCoverIds: [],
    collapsedFolders: [],
    editor: null,
    saveMode: "create",
    dirty: false,
    busy: false,
    version: 0,
    operation: 0,
    error: "",
    confirm: null,
  }));
}

export type LibrarySessionStore = ReturnType<typeof createLibrarySessionStore>;

/** Hold the session busy through the write and every refresh owned by that operation. */
export async function runLibraryOperation(store: LibrarySessionStore, action: () => Promise<void>) {
  if (store.getState().busy) return;
  store.setState({ busy: true, error: "" });
  try {
    await action();
  } catch (error) {
    store.setState({ error });
  } finally {
    store.setState({ busy: false });
  }
}

/** Record edits independently of the active save operation. */
export function editLibraryResource(store: LibrarySessionStore, resource: Resource) {
  const current = store.getState();
  if (!current.editor || resource.id !== current.editor.id) return;
  store.setState({
    version: current.version + 1,
    editor: resource,
    dirty: true,
  });
}

/** Apply an acknowledgement to whichever edit is current when the save finishes. */
export function acceptLibrarySave(
  store: LibrarySessionStore,
  request: { id: string; version: number; coverAssetId?: string | null },
  saved: Resource,
) {
  const current = store.getState();
  const merged = mergeResourceSave(current.editor, current.version, request, saved);
  if (merged) store.setState({ ...merged, saveMode: "update" });
}

/** Close the editor without releasing the operation that may still be refreshing data. */
export function dismissLibraryResource(store: LibrarySessionStore) {
  const current = store.getState();
  store.setState({
    operation: current.operation + 1,
    version: current.version + 1,
    editor: null,
    saveMode: "create",
    dirty: false,
  });
}

export type LibraryFilters = Pick<
  LibrarySessionState,
  | "query"
  | "kind"
  | "folderId"
  | "rootOnly"
  | "includeSubfolders"
  | "model"
  | "tag"
  | "sort"
  | "descending"
>;

/** A changed catalogue context starts at its first page with no stale selection. */
export function filterLibraryResources(store: LibrarySessionStore, patch: Partial<LibraryFilters>) {
  store.setState({ ...patch, offset: 0, selectedIds: [] });
}

/** A successful cut-paste consumes only the buffer that initiated that paste. */
export function completeLibraryPaste(store: LibrarySessionStore, selection: ResourceSelection) {
  const clipboard = store.getState().clipboard;
  if (clipboard?.cut && clipboard.selection === selection) store.setState({ clipboard: null });
}

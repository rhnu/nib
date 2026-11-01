import { createStore } from "zustand/vanilla";
import type {
  Resource,
  ResourceFolder,
  ResourceSaveMode,
  ResourceSelection,
} from "@/bindings/workbench";
import { mergeResourceSave } from "../resource-edit";
import type { NavigationDirection } from "@/shared/navigation/navigation-input";
import { folderAncestry } from "../resource-location";
import {
  createResourceBrowseHistory,
  createResourceBrowseState,
  moveResourceBrowseHistory,
  pruneResourceBrowseHistory,
  pushResourceBrowseHistory,
  type ResourceBrowseHistory,
  type ResourceBrowseState,
} from "./resource-browse-history";

export type LibrarySessionState = ResourceBrowseState & {
  browseHistory: ResourceBrowseHistory;
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
  const store = createStore<LibrarySessionState>(() => ({
    ...createResourceBrowseState(),
    browseHistory: createResourceBrowseHistory(createResourceBrowseState()),
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
  // Capture all browse writes, including pagination and context changes initiated by editors.
  // Restores publish their history and destination together, so they do not create new entries.
  store.subscribe((state, previous) => {
    if (state.browseHistory !== previous.browseHistory) return;
    const browseHistory = pushResourceBrowseHistory(state.browseHistory, state);
    if (browseHistory !== state.browseHistory) store.setState({ browseHistory });
  });
  return store;
}

export type LibrarySessionStore = ReturnType<typeof createLibrarySessionStore>;

/** Prune only after the folder catalogue has loaded successfully. */
export function pruneLibraryHistory(store: LibrarySessionStore, folders: ResourceFolder[]) {
  const current = store.getState();
  const browseHistory = pruneResourceBrowseHistory(
    current.browseHistory,
    new Set(folders.map((folder) => folder.id)),
  );
  if (browseHistory === current.browseHistory) return;
  store.setState({ ...browseHistory.entries[browseHistory.index], browseHistory, selectedIds: [] });
}

/** Browser history never dismisses an editor or bypasses its unsaved-change confirmation. */
export function moveLibraryHistory(
  store: LibrarySessionStore,
  direction: NavigationDirection,
  folders: ResourceFolder[],
) {
  const current = store.getState();
  if (current.editor || current.busy || current.confirm) return;
  const valid = pruneResourceBrowseHistory(
    current.browseHistory,
    new Set(folders.map((folder) => folder.id)),
  );
  const browseHistory = moveResourceBrowseHistory(valid, direction);
  if (browseHistory === current.browseHistory) return;
  const state = browseHistory.entries[browseHistory.index];
  const path = new Set(folderAncestry(state.folderId, folders).map((folder) => folder.id));
  store.setState({
    ...state,
    browseHistory,
    selectedIds: [],
    collapsedFolders: current.collapsedFolders.filter((id) => !path.has(id)),
  });
}

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

/** Return to browsing after an acknowledged save; preserve edits made after its snapshot. */
export function acceptLibrarySave(
  store: LibrarySessionStore,
  request: { id: string; version: number; coverAssetId?: string | null },
  saved: Resource,
) {
  const current = store.getState();
  const merged = mergeResourceSave(current.editor, current.version, request, saved);
  if (!merged) return;
  store.setState(
    merged.dirty
      ? { ...merged, saveMode: "update" }
      : { editor: null, dirty: false, saveMode: "create", selectedIds: [saved.id] },
  );
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
  "query" | "kind" | "folderId" | "model" | "tag" | "sort" | "descending"
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

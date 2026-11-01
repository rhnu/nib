import type { ResourceKind, ResourceSort } from "@/bindings/workbench";
import type { NavigationDirection } from "@/shared/navigation/navigation-input";

export type ResourceBrowseState = {
  query: string;
  kind: ResourceKind | "";
  folderId: string | null;
  model: string;
  tag: string;
  sort: ResourceSort;
  descending: boolean;
  offset: number;
};

export type ResourceBrowseHistory = {
  entries: ResourceBrowseState[];
  index: number;
};

export function createResourceBrowseState(
  patch: Partial<ResourceBrowseState> = {},
): ResourceBrowseState {
  return {
    query: "",
    kind: "",
    folderId: null,
    model: "",
    tag: "",
    sort: "name",
    descending: false,
    offset: 0,
    ...patch,
  };
}

/** Keep only browsing fields; editor and resource selection never enter navigation history. */
export function resourceBrowseState(state: ResourceBrowseState): ResourceBrowseState {
  const { query, kind, folderId, model, tag, sort, descending, offset } = state;
  return { query, kind, folderId, model, tag, sort, descending, offset };
}

function sameState(left: ResourceBrowseState, right: ResourceBrowseState) {
  return (
    left.query === right.query &&
    left.kind === right.kind &&
    left.folderId === right.folderId &&
    left.model === right.model &&
    left.tag === right.tag &&
    left.sort === right.sort &&
    left.descending === right.descending &&
    left.offset === right.offset
  );
}

export function createResourceBrowseHistory(state: ResourceBrowseState): ResourceBrowseHistory {
  return { entries: [resourceBrowseState(state)], index: 0 };
}

/** Each directory retains its latest filters/page; entering a directory starts a new visit. */
export function pushResourceBrowseHistory(
  history: ResourceBrowseHistory,
  state: ResourceBrowseState,
) {
  const current = history.entries[history.index];
  if (sameState(current, state)) return history;
  if (current.folderId === state.folderId) {
    const entries = [...history.entries];
    entries[history.index] = resourceBrowseState(state);
    return { ...history, entries };
  }
  const entries = [...history.entries.slice(0, history.index + 1), resourceBrowseState(state)];
  return { entries, index: entries.length - 1 };
}

/** Deleted folders disappear from past/future entries; an invalid current folder returns to root. */
export function pruneResourceBrowseHistory(history: ResourceBrowseHistory, folderIds: Set<string>) {
  if (history.entries.every((entry) => entry.folderId === null || folderIds.has(entry.folderId)))
    return history;
  const entries: ResourceBrowseState[] = [];
  let index = 0;
  for (let position = 0; position < history.entries.length; position++) {
    const entry = history.entries[position];
    const valid = entry.folderId === null || folderIds.has(entry.folderId);
    if (!valid && position !== history.index) continue;
    const next = valid ? entry : { ...entry, folderId: null, offset: 0 };
    if (!entries.length || !sameState(entries[entries.length - 1], next)) entries.push(next);
    if (position === history.index) index = entries.length - 1;
  }
  return { entries, index };
}

export function moveResourceBrowseHistory(
  history: ResourceBrowseHistory,
  direction: NavigationDirection,
) {
  const index = history.index + (direction === "back" ? -1 : 1);
  return index < 0 || index >= history.entries.length ? history : { ...history, index };
}

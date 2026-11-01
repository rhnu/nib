import { useState } from "react";
import type { ResourceFolder } from "@/bindings/workbench";
import type { NavigationDirection } from "@/shared/navigation/navigation-input";
import {
  createResourceBrowseHistory,
  moveResourceBrowseHistory,
  pruneResourceBrowseHistory,
  pushResourceBrowseHistory,
  type ResourceBrowseState,
} from "./resource-browse-history";

/** A picker owns an independent history for its current insertion kind and model. */
export function useResourceBrowseHistory(
  initialState: ResourceBrowseState,
  folders: ResourceFolder[] | undefined,
  scopeKey = "",
) {
  const [session, setSession] = useState(() => ({
    scopeKey,
    folders,
    history: createResourceBrowseHistory(initialState),
  }));
  if (session.scopeKey !== scopeKey)
    setSession({ scopeKey, folders, history: createResourceBrowseHistory(initialState) });
  else if (session.folders !== folders)
    setSession({
      ...session,
      folders,
      history: folders
        ? pruneResourceBrowseHistory(session.history, new Set(folders.map((folder) => folder.id)))
        : session.history,
    });

  const update = (patch: Partial<ResourceBrowseState>, resetPage = true) => {
    setSession((current) => {
      const state = current.history.entries[current.history.index];
      const history = pushResourceBrowseHistory(current.history, {
        ...state,
        ...(resetPage ? { offset: 0 } : {}),
        ...patch,
      });
      return history === current.history ? current : { ...current, history };
    });
  };

  const move = (direction: NavigationDirection) => {
    setSession((current) => {
      const valid = folders
        ? pruneResourceBrowseHistory(current.history, new Set(folders.map((folder) => folder.id)))
        : current.history;
      const history = moveResourceBrowseHistory(valid, direction);
      return history === current.history ? current : { ...current, history };
    });
  };

  const { history } = session;
  return {
    state: history.entries[history.index],
    update,
    move,
    canBack: history.index > 0,
    canForward: history.index + 1 < history.entries.length,
  };
}

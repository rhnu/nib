import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { filterLibraryResources, type LibraryFilters } from "./model/library-session";
import { resourceSearchQuery } from "./api";
import { useResourceResults } from "./use-resource-results";
import { useLibrarySessionStore } from "./model/library-session-context";

/** Search belongs to an exact filter and page, including the selected folder subtree. */
export function useResourceSearch(open: boolean) {
  const client = useQueryClient();
  const store = useLibrarySessionStore();
  const filters = useStore(
    store,
    useShallow(
      ({
        query,
        kind,
        folderId,
        rootOnly,
        includeSubfolders,
        model,
        tag,
        offset,
        sort,
        descending,
      }) => ({
        query,
        kind,
        folderId,
        rootOnly,
        includeSubfolders,
        model,
        tag,
        offset,
        sort,
        descending,
      }),
    ),
  );
  const {
    query,
    kind,
    folderId,
    rootOnly,
    includeSubfolders,
    model,
    tag,
    offset,
    sort,
    descending,
  } = filters;
  const requestQuery = resourceSearchQuery({
    text: query,
    kind: kind || null,
    folderId,
    rootOnly,
    includeSubfolders,
    sort,
    descending,
    models: model ? [model] : [],
    tags: tag ? [tag] : [],
    offset,
  });
  const results = useResourceResults(requestQuery, open);

  const refreshSearch = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["resource-search"] });
    void client.invalidateQueries({ queryKey: ["resource-tags"] });
  }, [client]);

  const filter = (patch: Partial<LibraryFilters>) => filterLibraryResources(store, patch);

  return {
    ...filters,
    filter,
    ...results,
    refreshSearch,
  };
}

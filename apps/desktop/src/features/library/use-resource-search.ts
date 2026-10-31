import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { filterLibraryResources, type LibraryFilters } from "./model/library-session";
import { resourceSearchQuery } from "./api";
import { resourceLocationQuery } from "./resource-location";
import { useResourceResults } from "./use-resource-results";
import { useLibrarySessionStore } from "./model/library-session-context";

/** Only a text search flattens the current folder's subtree. */
export function useResourceSearch(open: boolean) {
  const client = useQueryClient();
  const store = useLibrarySessionStore();
  const filters = useStore(
    store,
    useShallow(({ query, kind, folderId, model, tag, offset, sort, descending }) => ({
      query,
      kind,
      folderId,
      model,
      tag,
      offset,
      sort,
      descending,
    })),
  );
  const { query, kind, folderId, model, tag, offset, sort, descending } = filters;
  const requestQuery = resourceSearchQuery({
    text: query,
    kind: kind || null,
    ...resourceLocationQuery(folderId, query),
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

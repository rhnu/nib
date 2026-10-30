import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import type { ResourceKind } from "@/bindings/workbench";
import { errorMessage } from "@/shared/host/error";
import { useDebouncedValue } from "@/shared/query/use-debounced-value";
import { libraryApi } from "./api";
import { useLibrarySessionStore } from "./model/library-session-context";

/** Search results belong to the exact filter; input changes never expose old matches as current. */
export function useResourceSearch(open: boolean) {
  const client = useQueryClient();
  const store = useLibrarySessionStore();
  const query = useStore(store, (state) => state.query);
  const kind = useStore(store, (state) => state.kind);

  const setQuery = useCallback((query: string) => store.setState({ query }), [store]);

  const setKind = useCallback((kind: ResourceKind | "") => store.setState({ kind }), [store]);

  const key = JSON.stringify([query, kind]);
  const settledKey = useDebouncedValue(key, 150);
  const ready = open && settledKey === key;
  const request = useQuery({
    queryKey: ["resource-search", query, kind],
    queryFn: () => libraryApi.search({ text: query, kind: kind || null }),
    enabled: ready,
  });

  const refreshSearch = useCallback(() => {
    void client.invalidateQueries({ queryKey: ["resource-search"] });
  }, [client]);

  return {
    query,
    setQuery,
    kind,
    setKind,
    items: settledKey === key ? (request.data ?? []) : [],
    loading: open && (!ready || request.isPending || request.isFetching),
    queryError: ready && request.error ? errorMessage(request.error) : "",
    refreshSearch,
  };
}

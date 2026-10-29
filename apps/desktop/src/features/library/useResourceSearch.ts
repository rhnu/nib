import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ResourceKind } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { useDebouncedValue } from "../../shared/query/useDebouncedValue";
import { libraryApi } from "./api";

/** Search results belong to the exact filter; input changes never expose old matches as current. */
export function useResourceSearch(open: boolean) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ResourceKind | "">("");
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

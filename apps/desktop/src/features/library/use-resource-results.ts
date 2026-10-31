import { useQuery } from "@tanstack/react-query";
import type { ResourceQuery } from "@/bindings/workbench";
import { errorMessage } from "@/shared/host/error";
import { useDebouncedValue } from "@/shared/query/use-debounced-value";
import { libraryApi } from "./api";

/** Management and insertion share exact query identity, debounce and stale-result handling. */
export function useResourceResults(query: ResourceQuery, enabled = true) {
  const key = JSON.stringify(query);
  const settledKey = useDebouncedValue(key, 150);
  const ready = enabled && settledKey === key;
  const request = useQuery({
    queryKey: ["resource-search", key],
    queryFn: () => libraryApi.search(query),
    enabled: ready,
  });
  return {
    items: settledKey === key ? (request.data?.items ?? []) : [],
    total: settledKey === key ? (request.data?.total ?? 0) : 0,
    pageSize: query.limit,
    loading: enabled && (!ready || request.isPending || request.isFetching),
    queryError: ready && request.error ? errorMessage(request.error) : "",
    retry: request.refetch,
  };
}

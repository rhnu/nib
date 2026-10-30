import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hasDesktopHost } from "@/shared/host/invoke";
import { errorMessage } from "@/shared/host/error";
import { workbenchApi } from "@/features/workbench/api";

/** Startup supplies one editable session snapshot; it is not a second ongoing draft source. */
export function useWorkspaceStartup(enabled = true) {
  const hosted = hasDesktopHost();
  const query = useQuery({
    queryKey: ["workspace", "startup"],
    queryFn: workbenchApi.workspace,
    enabled: hosted && enabled,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const workspace = useMemo(
    () =>
      query.data
        ? {
            snapshot: query.data,
            resources: new Map(query.data.resources.map((item) => [item.id, item])),
          }
        : null,
    [query.data],
  );
  return {
    workspace,
    loading: hosted && (!enabled || query.isPending),
    error: query.error ? errorMessage(query.error) : "",
    retry: () => {
      if (hosted && enabled) void query.refetch();
    },
  };
}

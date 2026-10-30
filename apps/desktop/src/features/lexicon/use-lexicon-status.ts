import { useQuery } from "@tanstack/react-query";
import { lexiconApi, lexiconStatusKey } from "./api";

export function useLexiconStatus(enabled = true) {
  return useQuery({
    queryKey: lexiconStatusKey,
    queryFn: lexiconApi.status,
    enabled,
    staleTime: 5_000,
    refetchInterval: (query) =>
      query.state.data?.install &&
      ["downloading", "verifying", "activating"].includes(query.state.data.install.state)
        ? 500
        : false,
    retry: false,
  });
}

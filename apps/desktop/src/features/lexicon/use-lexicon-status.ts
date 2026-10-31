import { useQuery } from "@tanstack/react-query";
import { lexiconApi, lexiconStatusKey } from "./api";

export function useLexiconStatus(enabled = true) {
  return useQuery({
    queryKey: lexiconStatusKey,
    queryFn: lexiconApi.status,
    meta: { downloadableResource: "lexicon" },
    enabled,
    staleTime: 5_000,
    refetchInterval: (query) => (query.state.data?.loading ? 500 : 5_000),
    retry: false,
  });
}

import { useQuery, type QueryKey } from "@tanstack/react-query";
import { errorMessage } from "../../shared/host/error";

/** Explicit domain keys share immutable reads without mixing similarly named IDs. */
export function useMediaQuery<T>(
  queryKey: QueryKey,
  id: string | null,
  load: (id: string) => Promise<T>,
  staleTime = Infinity,
) {
  const query = useQuery({
    queryKey,
    queryFn: () => load(id!),
    enabled: id !== null,
    staleTime,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return {
    value: id === null ? null : (query.data ?? null),
    error: id !== null && query.error ? errorMessage(query.error) : null,
    loading: id !== null && query.isPending,
    retry: () => {
      if (id !== null) void query.refetch();
    },
  };
}

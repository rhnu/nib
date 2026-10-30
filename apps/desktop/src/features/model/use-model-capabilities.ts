import { useQuery } from "@tanstack/react-query";
import type { GenerationSettings } from "@/bindings/workbench";
import { errorMessage } from "@/shared/host/error";
import { useDebouncedValue } from "@/shared/query/use-debounced-value";
import { modelApi } from "./api";

/** SDK descriptor reads share cached choices and retain controls while the same model refreshes. */
export function useModelCapabilities(
  model?: string,
  settings?: GenerationSettings | null,
  enabled = true,
) {
  const key = JSON.stringify([model ?? null, settings ?? null]);
  const settledKey = useDebouncedValue(key, 150);
  const ready = settledKey === key;
  const query = useQuery({
    queryKey: ["model-capabilities", model ?? null, settings ?? null],
    queryFn: () => modelApi.capabilities(model, settings),
    enabled: enabled && ready,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === (model ?? null) ? previous : undefined,
  });
  return {
    capabilities: enabled ? (query.data ?? null) : null,
    error: enabled && ready && query.error ? errorMessage(query.error) : null,
    loading: enabled && (!ready || query.isPending || query.isFetching),
    retry: () => {
      if (enabled && ready) void query.refetch();
    },
  };
}

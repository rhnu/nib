import { useQuery } from "@tanstack/react-query";
import type { Draft } from "@/bindings/workbench";
import { errorMessage } from "@/shared/host/error";
import { useDebouncedValue } from "@/shared/query/use-debounced-value";
import { promptApi } from "./api";

/** Model-bearing edits invalidate retained controls; ordinary prompt and numeric edits do not. */
function modelContext(draft: Draft): string {
  return JSON.stringify([
    draft.settings.model,
    draft.inputs.operation.kind,
    draft.presets.map((preset) => [
      preset.enabled,
      preset.binding.kind === "linked"
        ? [preset.binding.resourceId, preset.binding.settingsOverrides.model]
        : preset.binding.defaults.model,
    ]),
  ]);
}

/** Resolution belongs to its exact draft; refreshing controls retain the same model's capabilities. */
export function useResolution(draft: Draft, resourceVersion: number) {
  const key = JSON.stringify([draft, resourceVersion]);
  const settledKey = useDebouncedValue(key, 180);
  const ready = settledKey === key;
  const query = useQuery({
    queryKey: ["draft-analysis", resourceVersion, draft],
    queryFn: () => promptApi.resolve(draft),
    enabled: ready,
    placeholderData: (previous, previousQuery) => {
      const previousDraft = previousQuery?.queryKey[2] as Draft | undefined;
      return previousDraft &&
        previousQuery?.queryKey[1] === resourceVersion &&
        modelContext(previousDraft) === modelContext(draft)
        ? previous
        : undefined;
    },
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const resolving = !ready || query.isPending || query.isFetching || query.isPlaceholderData;
  return {
    resolved: query.data?.resolved ?? null,
    capabilities: query.data?.capabilities ?? null,
    resolving,
    resolveError: ready && query.isError ? errorMessage(query.error) : "",
    retryResolution: () => void query.refetch(),
  };
}

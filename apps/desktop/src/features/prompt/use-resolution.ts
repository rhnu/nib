import { useQuery } from "@tanstack/react-query";
import type { Draft } from "@/bindings/workbench";
import { errorMessage } from "@/shared/host/error";
import { useDebouncedValue } from "@/shared/query/use-debounced-value";
import { promptApi } from "./api";
import { promptModelContext } from "./model-context";

export type ResolutionEvaluation = { includeQuote: boolean; quoteVersion: number };

/** Resolution belongs to its exact draft; refreshing controls retain the same model's capabilities. */
export function useResolution(
  draft: Draft,
  resourceVersion: number,
  { includeQuote, quoteVersion }: ResolutionEvaluation,
) {
  const quoteContext = includeQuote ? quoteVersion : null;
  const key = JSON.stringify([draft, resourceVersion, quoteContext]);
  const settledKey = useDebouncedValue(key, 180);
  const ready = settledKey === key;
  const query = useQuery({
    queryKey: ["draft-analysis", resourceVersion, draft, quoteContext],
    queryFn: () => promptApi.resolve(draft, includeQuote),
    enabled: ready,
    placeholderData: (previous, previousQuery) => {
      const previousDraft = previousQuery?.queryKey[2] as Draft | undefined;
      const compatible =
        previousDraft &&
        previousQuery?.queryKey[1] === resourceVersion &&
        promptModelContext(previousDraft) === promptModelContext(draft);
      if (!compatible || !previous) return undefined;
      return {
        ...previous,
        quote: previousQuery?.queryKey[3] === quoteContext ? previous.quote : null,
        quoteError: null,
      };
    },
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const resolving = !ready || query.isPending || query.isFetching || query.isPlaceholderData;
  const quoteReady = includeQuote && !resolving && !query.isError;
  return {
    resolved: query.data?.resolved ?? null,
    capabilities: query.data?.capabilities ?? null,
    resolving,
    resolveError: ready && query.isError ? errorMessage(query.error) : "",
    // Retained analysis is suitable for controls, but cannot authorize an edited request.
    quote: quoteReady ? (query.data?.quote ?? null) : null,
    displayQuote: includeQuote && !query.isError ? (query.data?.quote ?? null) : null,
    quoteError: quoteReady ? (query.data?.quoteError ?? null) : null,
    quoteReady,
    retryResolution: () => void query.refetch(),
  };
}

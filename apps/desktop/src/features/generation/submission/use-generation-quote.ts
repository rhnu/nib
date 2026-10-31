import { useQuery } from "@tanstack/react-query";
import { submissionApi } from "./api";
import type { Draft } from "@/bindings/workbench";
import type { GenerationQuote } from "@/bindings/generation";
import { errorMessage } from "@/shared/host/error";
import { useDebouncedValue } from "@/shared/query/use-debounced-value";
import { useDelayedPending } from "@/shared/query/use-delayed-pending";
import { promptModelContext } from "@/features/prompt/model-context";
import { generationQuoteKey } from "./quote-state";

type AnalyzedQuote = {
  quote: GenerationQuote | null;
  displayQuote: GenerationQuote | null;
  quoteError: unknown;
  quoteReady: boolean;
  resolving: boolean;
  retryResolution: () => void;
};

export function useGenerationQuote(
  draft: Draft,
  refreshKey?: unknown,
  enabled = true,
  displayCompatible = true,
  analysis?: AnalyzedQuote,
) {
  const key = generationQuoteKey(draft, refreshKey);
  const displayContext = JSON.stringify([promptModelContext(draft), refreshKey ?? null]);
  const settledKey = useDebouncedValue(analysis ? "combined" : key, 250);
  const ready = enabled && (analysis ? analysis.quoteReady : key === settledKey);
  const query = useQuery({
    queryKey: ["quote", key, displayContext],
    queryFn: () => submissionApi.quote(draft),
    enabled: !analysis && ready,
    placeholderData: (previous, previousQuery) =>
      displayCompatible && previousQuery?.queryKey[2] === displayContext ? previous : undefined,
    staleTime: Infinity,
    gcTime: 30_000,
  });
  const quote = analysis
    ? ready
      ? analysis.quote
      : null
    : ready && !query.isPlaceholderData && !query.isFetching && !query.isError
      ? (query.data ?? null)
      : null;
  const failure = analysis ? analysis.quoteError : query.error;
  const displayQuote = analysis
    ? analysis.displayQuote
    : query.isError
      ? null
      : (query.data ?? null);
  const refreshing =
    displayCompatible &&
    (analysis
      ? analysis.resolving
      : !ready || query.isPending || query.isFetching || query.isPlaceholderData);
  const loadingIndicator = useDelayedPending(refreshing);
  return {
    key,
    quote,
    // This value is cosmetic only. Submission must use the exact current quote above.
    displayQuote: displayCompatible ? displayQuote : null,
    refreshing,
    loadingIndicator,
    error: ready && failure ? errorMessage(failure) : null,
    fields: ready ? validationFields(failure) : [],
    loading:
      enabled &&
      (analysis
        ? !analysis.quoteReady
        : !ready || query.isPending || query.isFetching || query.isPlaceholderData),
    retry: () => {
      if (analysis) analysis.retryResolution();
      else if (ready) void query.refetch();
    },
  };
}

export function validationFields(error: unknown): string[] {
  if (typeof error !== "object" || error === null || !("validationFields" in error)) return [];
  return Array.isArray(error.validationFields)
    ? error.validationFields.filter((field): field is string => typeof field === "string")
    : [];
}

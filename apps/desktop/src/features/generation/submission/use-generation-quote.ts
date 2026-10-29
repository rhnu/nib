import { useQuery } from "@tanstack/react-query";
import { submissionApi } from "./api";
import type { Draft } from "../../../bindings/workbench";
import { errorMessage } from "../../../shared/host/error";
import { useDebouncedValue } from "../../../shared/query/useDebouncedValue";
import { generationQuoteKey } from "./quote-state";

export function useGenerationQuote(draft: Draft, refreshKey?: unknown, enabled = true) {
  const key = generationQuoteKey(draft, refreshKey);
  const settledKey = useDebouncedValue(key, 250);
  const ready = enabled && key === settledKey;
  const query = useQuery({
    queryKey: ["quote", key],
    queryFn: () => submissionApi.quote(draft),
    enabled: ready,
    staleTime: Infinity,
    gcTime: 30_000,
  });
  return {
    key,
    quote: ready ? (query.data ?? null) : null,
    error: ready && query.error ? errorMessage(query.error) : null,
    fields: ready ? validationFields(query.error) : [],
    loading: enabled && (!ready || query.isPending),
    retry: () => {
      if (ready) void query.refetch();
    },
  };
}

export function validationFields(error: unknown): string[] {
  if (typeof error !== "object" || error === null || !("validationFields" in error)) return [];
  return Array.isArray(error.validationFields)
    ? error.validationFields.filter((field): field is string => typeof field === "string")
    : [];
}

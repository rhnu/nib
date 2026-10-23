import { submissionApi } from "./api";
import { useEffect, useState } from "react";
import type { Draft } from "../../../bindings/workbench";
import type { GenerationQuote } from "../../../bindings/generation";
import { errorMessage } from "../../../shared/host/error";
import { generationQuoteKey } from "./quote-state";

export function useGenerationQuote(draft: Draft, refreshKey?: unknown, enabled = true) {
  const key = generationQuoteKey(draft, refreshKey);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    quote: GenerationQuote | null;
    error: string | null;
    fields: string[];
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void submissionApi.quote(draft).then(
        (quote) => {
          if (!cancelled) setState({ key, quote, error: null, fields: [] });
        },
        (error: unknown) => {
          if (!cancelled)
            setState({
              key,
              quote: null,
              error: errorMessage(error),
              fields: validationFields(error),
            });
        },
      );
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, draft, attempt, enabled]);
  const current = enabled && state?.key === key ? state : null;
  return {
    key,
    quote: current?.quote ?? null,
    error: current?.error ?? null,
    fields: current?.fields ?? [],
    loading: enabled && !current,
    retry: () => {
      setState(null);
      setAttempt((value) => value + 1);
    },
  };
}

export function validationFields(error: unknown): string[] {
  if (typeof error !== "object" || error === null || !("validationFields" in error)) return [];
  return Array.isArray(error.validationFields)
    ? error.validationFields.filter((field): field is string => typeof field === "string")
    : [];
}

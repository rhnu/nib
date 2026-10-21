import { useEffect, useState } from "react";
import type { Draft } from "../../bindings/workbench";
import type { GenerationQuote } from "../../bindings/generation";
import { errorMessage } from "../../shared/host/error";
import { generationApi } from "./api";
import { generationQuoteKey } from "./quote-state";

export function useGenerationQuote(draft: Draft, refreshKey?: unknown, enabled = true) {
  const key = generationQuoteKey(draft, refreshKey);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    quote: GenerationQuote | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void generationApi.quote(draft).then(
        (quote) => {
          if (!cancelled) setState({ key, quote, error: null });
        },
        (error: unknown) => {
          if (!cancelled) setState({ key, quote: null, error: errorMessage(error) });
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
    loading: enabled && !current,
    retry: () => {
      setState(null);
      setAttempt((value) => value + 1);
    },
  };
}

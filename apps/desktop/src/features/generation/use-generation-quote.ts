import { useEffect, useState } from "react";
import type { Draft } from "../../bindings/workbench";
import type { GenerationQuote } from "../../bindings/generation";
import { errorMessage } from "../../shared/host/error";
import { generationApi } from "./api";

// Saving a new revision does not change the content whose SDK estimate is displayed.
export function draftContentKey(draft: Draft): string {
  return JSON.stringify([draft.composition, draft.presets, draft.settings]);
}

export function useGenerationQuote(draft: Draft, refreshKey?: unknown) {
  const key = `${draftContentKey(draft)}:${String(refreshKey ?? "")}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{
    key: string;
    quote: GenerationQuote | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
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
  }, [key, draft, attempt]);
  const current = state?.key === key ? state : null;
  return {
    key: draftContentKey(draft),
    quote: current?.quote ?? null,
    error: current?.error ?? null,
    loading: !current,
    retry: () => {
      setState(null);
      setAttempt((value) => value + 1);
    },
  };
}

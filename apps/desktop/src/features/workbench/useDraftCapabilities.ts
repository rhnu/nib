import { useEffect, useState } from "react";
import type { Draft, ModelCapabilities } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { generationQuoteKey } from "../generation/quote-state";
import { workbenchApi } from "./api";

/** Main editor options follow its actual operation and ordered preset context. */
export function useDraftCapabilities(draft: Draft, resourceVersion: number) {
  const key = generationQuoteKey(draft, resourceVersion);
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<{
    key: string;
    attempt: number;
    capabilities: ModelCapabilities | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void workbenchApi.capabilities(draft).then(
      (capabilities) => {
        if (active) setResponse({ key, attempt, capabilities, error: null });
      },
      (cause: unknown) => {
        if (active) setResponse({ key, attempt, capabilities: null, error: errorMessage(cause) });
      },
    );
    return () => {
      active = false;
    };
  }, [key, draft, attempt]);
  const current = response?.key === key && response.attempt === attempt ? response : null;
  return {
    capabilities: current?.capabilities ?? null,
    error: current?.error ?? null,
    loading: current === null,
    retry: () => setAttempt((value) => value + 1),
  };
}

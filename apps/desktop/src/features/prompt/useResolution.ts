import { useEffect, useState } from "react";
import type { Draft, DraftAnalysis } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { promptApi } from "./api";
export function useResolution(draft: Draft, resourceVersion: number) {
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<{
    draft: Draft;
    resourceVersion: number;
    attempt: number;
    value: DraftAnalysis | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void promptApi.resolve(draft).then(
        (value) => {
          if (active) setResponse({ draft, resourceVersion, attempt, value, error: "" });
        },
        (cause) => {
          if (active)
            setResponse({
              draft,
              resourceVersion,
              attempt,
              value: null,
              error: errorMessage(cause),
            });
        },
      );
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draft, resourceVersion, attempt]);
  const resolving =
    response?.draft !== draft ||
    response?.resourceVersion !== resourceVersion ||
    response?.attempt !== attempt;
  return {
    resolved: response?.value?.resolved ?? null,
    capabilities: resolving ? null : (response?.value?.capabilities ?? null),
    resolving,
    resolveError: resolving ? "" : response.error,
    retryResolution: () => setAttempt((value) => value + 1),
  };
}

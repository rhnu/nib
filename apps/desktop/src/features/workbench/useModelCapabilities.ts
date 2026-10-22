import { useEffect, useState } from "react";
import type { GenerationSettings, ModelCapabilities } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { workbenchApi } from "./api";

/** Editable choices come from the SDK descriptor, including for a sparse preset. */
export function useModelCapabilities(
  model?: string,
  settings?: GenerationSettings | null,
  enabled = true,
) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([model ?? null, settings ?? null]);
  const [response, setResponse] = useState<{
    key: string;
    attempt: number;
    capabilities: ModelCapabilities | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void workbenchApi.modelCapabilities(model, settings).then(
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
  }, [key, model, settings, attempt, enabled]);
  const current =
    enabled && response && response.key === key && response.attempt === attempt ? response : null;
  return {
    capabilities: current?.capabilities ?? null,
    error: current?.error ?? null,
    loading: enabled && current === null,
    retry: () => setAttempt((value) => value + 1),
  };
}

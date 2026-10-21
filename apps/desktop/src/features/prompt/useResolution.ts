import { useEffect, useState } from "react";
import type { Draft, Resource, ResolvedDraft } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { promptApi } from "./api";
export function useResolution(draft: Draft, resources: Map<string, Resource>) {
  const [response, setResponse] = useState<{
    draft: Draft;
    resources: Map<string, Resource>;
    value: ResolvedDraft | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void promptApi.resolve(draft).then(
        (value) => {
          if (active) setResponse({ draft, resources, value, error: "" });
        },
        (cause) => {
          if (active) setResponse({ draft, resources, value: null, error: errorMessage(cause) });
        },
      );
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draft, resources]);
  const resolving = response?.draft !== draft || response?.resources !== resources;
  return {
    resolved: response?.value ?? null,
    resolving,
    resolveError: resolving ? "" : response.error,
  };
}

import { useCallback, useEffect, useState } from "react";
import type { ResourceKind, ResourceSummary } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { libraryApi } from "./api";
/** Query changes invalidate responses before the next debounced request starts. */
export function useResourceSearch(open: boolean) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ResourceKind | "">("");
  const [epoch, setEpoch] = useState(0);
  const key = JSON.stringify([query, kind, epoch]);
  const [response, setResponse] = useState<{
    key: string;
    items: ResourceSummary[];
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = setTimeout(() => {
      void libraryApi.search({ text: query, kind: kind || null }).then(
        (items) => {
          if (active) setResponse({ key, items, error: "" });
        },
        (cause) => {
          if (active) setResponse({ key, items: [], error: errorMessage(cause) });
        },
      );
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [open, query, kind, key]);
  const refreshSearch = useCallback(() => setEpoch((value) => value + 1), []);
  return {
    query,
    setQuery,
    kind,
    setKind,
    items: response?.items ?? [],
    loading: open && response?.key !== key,
    queryError: response?.key === key ? response.error : "",
    refreshSearch,
  };
}

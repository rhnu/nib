import { useCallback, useEffect, useRef, useState } from "react";
import type { Resource } from "../../bindings/workbench";
import { libraryApi } from "./api";
/** A read-only resource query cache; only host writes can change resource facts. */
export function useResourceCache(initial: Map<string, Resource>) {
  const [resources, setResources] = useState(initial);
  const epoch = useRef(0);
  const [resourceVersion, setResourceVersion] = useState(0);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  const refreshResources = useCallback(async () => {
    const request = ++epoch.current;
    // A successful host write already changed resolution, even if reloading the cache fails.
    setResourceVersion((value) => value + 1);
    const summaries = await libraryApi.search({ text: "", kind: null });
    const fetched = await Promise.all(summaries.map((summary) => libraryApi.resource(summary.id)));
    if (request === epoch.current) {
      setResources(new Map(fetched.map((item) => [item.id, item])));
    }
  }, []);
  return { resources, refreshResources, resourceVersion };
}

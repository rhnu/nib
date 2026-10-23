import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft, Resource } from "../../bindings/workbench";
import { errorMessage } from "../../shared/host/error";
import { libraryApi } from "./api";
import { draftResourceIds } from "./resource-dependencies";

/** Cache only definitions requested by creation and resource editors, never the entire library. */
export function useResourceCache(initial: Map<string, Resource>, draft: Draft) {
  const [resources, setResources] = useState(initial);
  const [resourceVersion, setResourceVersion] = useState(0);
  const [resourceError, setResourceError] = useState("");
  const state = useRef({
    active: true,
    epoch: 0,
    checked: new Set(initial.keys()),
    resources: initial,
  });
  const pending = useRef(new Map<string, Promise<void>>());
  useEffect(() => {
    const current = state.current;
    current.active = true;
    return () => {
      current.active = false;
      current.epoch++;
    };
  }, []);
  const ensureResources = useCallback((ids: string[], force = false): Promise<void> => {
    const current = state.current;
    const needed = [...new Set(ids)].filter((id) => force || !current.checked.has(id)).sort();
    if (!needed.length) return Promise.resolve();
    const key = JSON.stringify([current.epoch, needed]);
    const existing = pending.current.get(key);
    if (existing) return existing;
    const epoch = current.epoch;
    const request = libraryApi
      .definitions(needed)
      .then((fetched) => {
        if (!current.active || epoch !== current.epoch) return;
        const next = new Map(current.resources);
        for (const id of needed) {
          next.delete(id);
          current.checked.add(id);
        }
        for (const resource of fetched) {
          next.set(resource.id, resource);
          current.checked.add(resource.id);
        }
        current.resources = next;
        setResources(next);
        setResourceError("");
      })
      .catch((cause: unknown) => {
        if (current.active && epoch === current.epoch) throw cause;
      })
      .finally(() => {
        pending.current.delete(key);
      });
    pending.current.set(key, request);
    return request;
  }, []);
  const refreshResources = useCallback(
    async (id: string) => {
      state.current.epoch++;
      state.current.checked.delete(id);
      // A successful write invalidates resolved data even when refreshing definitions fails.
      setResourceVersion((version) => version + 1);
      await ensureResources([id], true);
    },
    [ensureResources],
  );
  const dependencyKey = JSON.stringify(draftResourceIds(draft));
  useEffect(() => {
    void ensureResources(JSON.parse(dependencyKey) as string[]).catch((cause: unknown) => {
      if (state.current.active) setResourceError(errorMessage(cause));
    });
  }, [dependencyKey, ensureResources, resourceVersion]);
  return {
    resources,
    resourceVersion,
    resourceError,
    refreshResources,
    ensureResources,
    retryResources: () => setResourceVersion((version) => version + 1),
  };
}

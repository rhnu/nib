import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isCancelledError, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Draft, Resource } from "@/bindings/workbench";
import { errorMessage } from "@/shared/host/error";
import { draftResourceIds } from "./resource-dependencies";
import { resourceQuery } from "./resource-queries";

function resourceSnapshot(client: QueryClient) {
  const queries = client.getQueryCache().findAll({ queryKey: ["resource"] });
  return {
    resources: new Map(
      queries.flatMap((query) => {
        const resource = query.state.data as Resource | null | undefined;
        return resource ? [[resource.id, resource] as const] : [];
      }),
    ),
    resourceError: queries
      .map((query) => query.state.error)
      .filter(Boolean)
      .map(errorMessage)
      .join("；"),
  };
}

/** Subscribe to Query's resource facts without maintaining a second writable definition store. */
function resourceStore(client: QueryClient) {
  let snapshot = resourceSnapshot(client);
  return {
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => {
      snapshot = resourceSnapshot(client);
      return client.getQueryCache().subscribe((event) => {
        if (
          event.query.queryKey[0] === "resource" &&
          (event.type === "updated" || event.type === "removed")
        ) {
          snapshot = resourceSnapshot(client);
          notify();
        }
      });
    },
  };
}

/** Query owns fetched definitions; the returned map is a read-only projection for prompt consumers. */
export function useResourceCache(initial: Map<string, Resource>, draft: Draft) {
  const client = useQueryClient();
  const [resourceVersion, setResourceVersion] = useState(0);
  useState(() => {
    client.setQueryDefaults(["resource"], { staleTime: Infinity, gcTime: Infinity });
    for (const [id, resource] of initial) {
      if (client.getQueryData(["resource", id]) === undefined)
        client.setQueryData(["resource", id], resource);
    }
    return true;
  });
  const store = useMemo(() => resourceStore(client), [client]);
  const { resources, resourceError } = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const ensureResources = useCallback(
    async (ids: string[], force = false) => {
      const unique = [...new Set(ids)];
      if (force)
        await Promise.all(
          unique.map((id) =>
            client.invalidateQueries({
              queryKey: ["resource", id],
              exact: true,
              refetchType: "none",
            }),
          ),
        );
      await Promise.all(
        unique.map((id) =>
          client.fetchQuery(resourceQuery(client, id)).catch((cause: unknown) => {
            if (!isCancelledError(cause)) throw cause;
          }),
        ),
      );
    },
    [client],
  );

  const refreshResources = useCallback(
    async (id: string) => {
      await client.cancelQueries({ queryKey: ["resource"] });
      setResourceVersion((version) => version + 1);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["draft-analysis"], refetchType: "none" }),
        client.invalidateQueries({ queryKey: ["quote"], refetchType: "none" }),
      ]);
      await ensureResources([id], true);
    },
    [client, ensureResources],
  );

  const dependencyKey = JSON.stringify(draftResourceIds(draft));
  useEffect(() => {
    void ensureResources(JSON.parse(dependencyKey) as string[]).catch(() => {
      // Query retains read errors; callers can retry without replacing the current draft.
    });
  }, [dependencyKey, ensureResources, resourceVersion]);
  return {
    resources,
    resourceVersion,
    resourceError,
    refreshResources,
    ensureResources,
    retryResources: () => {
      setResourceVersion((version) => version + 1);
      void ensureResources(JSON.parse(dependencyKey) as string[], true).catch(() => {});
    },
  };
}

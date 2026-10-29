import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { Resource } from "../../bindings/workbench";
import { libraryApi } from "./api";

type PendingRead = {
  signal: AbortSignal;
  resolve: (resource: Resource | null) => void;
  reject: (cause: unknown) => void;
};
const batches = new WeakMap<QueryClient, Map<string, PendingRead[]>>();

/** Coalesce current definition reads into the host's transactional dependency lookup. */
function readDefinition(
  client: QueryClient,
  id: string,
  signal: AbortSignal,
): Promise<Resource | null> {
  const existing = batches.get(client);
  const batch = existing ?? new Map<string, PendingRead[]>();
  if (!existing) {
    batches.set(client, batch);
    queueMicrotask(() => {
      batches.delete(client);
      const activeIds = [...batch.keys()].filter((key) =>
        batch.get(key)!.some((read) => !read.signal.aborted),
      );
      if (!activeIds.length) {
        for (const reads of batch.values()) for (const read of reads) read.resolve(null);
        return;
      }
      void libraryApi.definitions(activeIds).then(
        (resources) => {
          // A write cancels old reads; their dependency snapshot must not overwrite newer definitions.
          if ([...batch.values()].some((reads) => reads.some((read) => !read.signal.aborted))) {
            for (const resource of resources) {
              if (!batch.has(resource.id)) client.setQueryData(["resource", resource.id], resource);
            }
          }
          const byId = new Map(resources.map((resource) => [resource.id, resource]));
          for (const [key, reads] of batch)
            for (const read of reads) read.resolve(byId.get(key) ?? null);
        },
        (cause: unknown) => {
          for (const reads of batch.values()) for (const read of reads) read.reject(cause);
        },
      );
    });
  }
  return new Promise((resolve, reject) => {
    const reads = batch.get(id) ?? [];
    reads.push({ signal, resolve, reject });
    batch.set(id, reads);
  });
}

/** Missing resources are cached as absent, while read failures remain query errors. */
export function resourceQuery(client: QueryClient, id: string) {
  return queryOptions({
    queryKey: ["resource", id] as const,
    queryFn: ({ signal }) => readDefinition(client, id, signal),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

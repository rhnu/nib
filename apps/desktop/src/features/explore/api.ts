import type {
  ExploreError,
  ExploreDetail,
  ExploreItemKey,
  ExploreMediaVariant,
  ExplorePage,
  ExploreQuery,
} from "@/bindings/explore";
import type { MediaAsset, MetadataRestore } from "@/bindings/media";
import type { DanbooruConnectionStatus } from "@/bindings/settings";
import { queryClient } from "@/shared/query/client";
import { invokeHost } from "@/shared/host/invoke";

/** Authentication failures publish the current connection before stale content can be reused. */
async function invokeExplore<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invokeHost<T>(command, args);
  } catch (error) {
    const kind =
      error && typeof error === "object" && "kind" in error ? (error as ExploreError).kind : null;
    const input = args.key ?? args.query;
    const danbooru =
      input && typeof input === "object" && "source" in input && input.source === "danbooru";
    if (danbooru && (kind === "unauthorized" || kind === "staleIdentity")) {
      await queryClient
        .fetchQuery({ queryKey: danbooruConnectionKey, queryFn: danbooruApi.status, staleTime: 0 })
        .catch(() => {});
    }
    throw error;
  }
}

export const exploreApi = {
  search: (query: ExploreQuery, cursor: string | null) =>
    invokeExplore<ExplorePage>("search_explore", { query, cursor }),
  detail: (key: ExploreItemKey) => invokeExplore<ExploreDetail>("get_explore_detail", { key }),
  media: (key: ExploreItemKey, variant: ExploreMediaVariant) =>
    invokeExplore<ArrayBuffer>("read_explore_media", { key, variant }),
  importImage: (key: ExploreItemKey) => invokeExplore<MediaAsset>("import_explore_image", { key }),
  restore: (key: ExploreItemKey) =>
    invokeExplore<MetadataRestore>("restore_explore_metadata", { key }),
};

export const danbooruConnectionKey = ["danbooru-connection"] as const;
export const danbooruApi = {
  async status() {
    const status = await invokeHost<DanbooruConnectionStatus>("get_danbooru_connection");
    queryClient.removeQueries({
      predicate: (query) => {
        const key = query.queryKey;
        if (key[0] !== "explore") return false;
        if (key[1] === "search") return key[2] === "danbooru" && key[3] !== status.revision;
        const identity = key[2];
        return (
          key[1] === "detail" &&
          identity !== null &&
          typeof identity === "object" &&
          "source" in identity &&
          identity.source === "danbooru" &&
          "authRevision" in identity &&
          identity.authRevision !== status.revision
        );
      },
    });
    return status;
  },
  save: (username: string, apiKey: string) =>
    invokeHost<DanbooruConnectionStatus>("save_danbooru_connection", { username, apiKey }),
  verify: () => invokeHost<DanbooruConnectionStatus>("verify_danbooru_connection"),
  disconnect: () => invokeHost<DanbooruConnectionStatus>("disconnect_danbooru_connection"),
};

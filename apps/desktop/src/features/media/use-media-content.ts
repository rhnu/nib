import { useMemo, useSyncExternalStore } from "react";
import { errorMessage } from "@/shared/host/error";
import { mediaApi } from "./api";
import { MediaContentStore, type ContentSnapshot } from "./content-store";

const contents = new MediaContentStore((url) => URL.revokeObjectURL(url));
const absent: ContentSnapshot = { url: null, error: null, loading: false };
const noSubscription = () => () => {};
const noSnapshot = () => absent;

export function useMediaContent(
  id: string | null,
  mimeType: string,
  available: boolean,
  variant: "original" | "thumbnail" = "original",
) {
  const resource = useMemo(
    () =>
      id && available
        ? contents.resource(`${variant}:${id}`, async () => {
            const bytes = await (variant === "thumbnail"
              ? mediaApi.thumbnail(id)
              : mediaApi.content(id));
            return URL.createObjectURL(
              new Blob([bytes], {
                type: variant === "thumbnail" ? "image/png" : mimeType,
              }),
            );
          })
        : null,
    [id, mimeType, available, variant],
  );
  const state = useSyncExternalStore(
    resource?.subscribe ?? noSubscription,
    resource?.getSnapshot ?? noSnapshot,
  );
  return {
    url: state.url,
    error: state.error ? errorMessage(state.error) : null,
    loading: state.loading,
    retry: resource?.retry ?? (() => {}),
    failed: resource?.failed ?? (() => {}),
  };
}

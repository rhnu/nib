import { mediaApi } from "./api";
import { useMediaQuery } from "./use-media-query";

export function useMediaAsset(id: string | null) {
  const {
    value: asset,
    error,
    loading,
    retry,
  } = useMediaQuery(["media", "asset", id], id, mediaApi.asset);
  return { asset, error, loading, retry };
}

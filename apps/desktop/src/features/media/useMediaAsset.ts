import { mediaApi } from "./api";
import { useMediaQuery } from "./useMediaQuery";

export function useMediaAsset(id: string | null) {
  const { value: asset, error, loading, retry } = useMediaQuery(id, mediaApi.asset);
  return { asset, error, loading, retry };
}

import { useEffect, useState } from "react";
import { errorMessage } from "../../shared/host/error";
import { loadMaskBitmap } from "./raster";

export function useMaskBitmaps(sourceId: string, baseMaskId: string | null) {
  const [attempt, setAttempt] = useState(0);
  const key = JSON.stringify([sourceId, baseMaskId, attempt]);
  const [state, setState] = useState<{
    key: string;
    source: ImageBitmap | null;
    mask: ImageBitmap | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    let active = true;
    let source: ImageBitmap | null = null;
    let mask: ImageBitmap | null = null;
    const close = () => {
      source?.close();
      mask?.close();
      source = null;
      mask = null;
    };
    void (async () => {
      try {
        source = await loadMaskBitmap(sourceId);
        if (!active) {
          close();
          return;
        }
        if (baseMaskId) mask = await loadMaskBitmap(baseMaskId);
        if (!active) {
          close();
          return;
        }
        setState({ key, source, mask, error: null });
      } catch (cause) {
        close();
        if (active) setState({ key, source: null, mask: null, error: errorMessage(cause) });
      }
    })();
    return () => {
      active = false;
      close();
    };
  }, [sourceId, baseMaskId, key]);
  const current = state?.key === key ? state : null;
  return {
    source: current?.source ?? null,
    mask: current?.mask ?? null,
    error: current?.error ?? null,
    loading: current === null,
    retry: () => setAttempt((value) => value + 1),
  };
}

import { useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../shared/host/error";
import { generationApi } from "./api";

export function useResultImage(id: string, mimeType: string, available: boolean) {
  const [attempt, setAttempt] = useState(0);
  const source = useMemo(
    () => ({ id, mimeType, available, attempt }),
    [id, mimeType, available, attempt],
  );
  const [state, setState] = useState<{
    source: typeof source;
    url: string | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void generationApi.image(id).then(
      (bytes) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        setState({ source, url: objectUrl, error: null });
      },
      (error: unknown) => {
        if (!cancelled) setState({ source, url: null, error: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [source, id, mimeType, available]);
  const current = state?.source === source ? state : null;
  return {
    url: available ? (current?.url ?? null) : null,
    error: current?.error ?? null,
    failed: () => setState({ source, url: null, error: "图像内容无法显示，请重新读取。" }),
    retry: () => {
      setState(null);
      setAttempt((value) => value + 1);
    },
  };
}

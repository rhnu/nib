import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../shared/host/error";

/** A read belongs to one input and attempt; previous reads cannot replace it. */
export function useMediaQuery<T>(id: string | null, load: (id: string) => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const source = useMemo(() => ({ id, attempt }), [id, attempt]);
  const [state, setState] = useState<{
    source: typeof source;
    value: T | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (id === null) return;
    let active = true;
    void load(id).then(
      (value) => {
        if (active) setState({ source, value, error: null });
      },
      (cause: unknown) => {
        if (active) setState({ source, value: null, error: errorMessage(cause) });
      },
    );
    return () => {
      active = false;
    };
  }, [id, source, load]);
  const current = state?.source === source ? state : null;
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    value: id === null ? null : (current?.value ?? null),
    error: id === null ? null : (current?.error ?? null),
    loading: id !== null && current === null,
    retry,
  };
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage } from "../../shared/host/error";
import { isCurrentRequest } from "./text-assist";

type RequestState<T> = { key: string; pending: boolean; value: T | null; error: string };

/** Discard late results when inputs change, requests overlap, or the editor closes. */
export function useAssistRequest<T>(key: string) {
  const latest = useRef({ key, sequence: 0, active: true });
  const [state, setState] = useState<RequestState<T>>({
    key,
    pending: false,
    value: null,
    error: "",
  });
  useLayoutEffect(() => {
    if (latest.current.key !== key) {
      latest.current.key = key;
      latest.current.sequence += 1;
      setState({ key, pending: false, value: null, error: "" });
    }
  }, [key]);
  useEffect(() => {
    const current = latest.current;
    current.active = true;
    return () => {
      current.active = false;
      current.sequence += 1;
    };
  }, []);
  const run = useCallback(async (load: () => Promise<T>) => {
    const request = { key: latest.current.key, sequence: ++latest.current.sequence };
    setState({ key: request.key, pending: true, value: null, error: "" });
    try {
      const value = await load();
      if (isCurrentRequest(request, latest.current))
        setState({ key: request.key, pending: false, value, error: "" });
    } catch (cause) {
      if (isCurrentRequest(request, latest.current))
        setState({ key: request.key, pending: false, value: null, error: errorMessage(cause) });
    }
  }, []);
  return {
    pending: state.key === key && state.pending,
    value: state.key === key ? state.value : null,
    error: state.key === key ? state.error : "",
    run,
  };
}

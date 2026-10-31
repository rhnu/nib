import { useEffect, useState } from "react";

/** Brief work stays visually quiet; completed work clears the indicator immediately. */
export function useDelayedPending(pending: boolean, delay = 120) {
  const [state, setState] = useState({ pending, visible: false });
  if (state.pending !== pending) setState({ pending, visible: false });
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setState({ pending, visible: true }), delay);
    return () => clearTimeout(timer);
  }, [pending, delay]);
  return pending && state.pending === pending && state.visible;
}

import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/shared/host/error";
import { trackPendingWork } from "@/shared/host/pending-work";

/** Includes materialization and its final editor commit in the global transition barrier. */
export function useVibeAction() {
  const state = useRef({ active: true, locked: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const current = state.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);
  async function run(action: (active: () => boolean) => Promise<void>) {
    if (state.current.locked) return;
    state.current.locked = true;
    setBusy(true);
    setError(null);
    try {
      await trackPendingWork(action(() => state.current.active));
    } catch (cause) {
      if (state.current.active) setError(errorMessage(cause));
    } finally {
      state.current.locked = false;
      if (state.current.active) setBusy(false);
    }
  }
  return { busy, error, run };
}

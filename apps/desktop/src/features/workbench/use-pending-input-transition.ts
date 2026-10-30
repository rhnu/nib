import { useEffect, useRef } from "react";
import { hasPendingWork, waitForPendingWork } from "@/shared/host/pending-work";
import { errorMessage } from "@/shared/host/error";

/** Finish input commits before replacing their editor; only the latest requested transition wins. */
export function usePendingInputTransition(onError: (message: string) => void) {
  const lifetime = useRef({ active: true, sequence: 0 });
  useEffect(() => {
    const current = lifetime.current;
    current.active = true;
    return () => {
      current.active = false;
      current.sequence++;
    };
  }, []);
  return (action: () => void) => {
    const current = lifetime.current;
    const sequence = ++current.sequence;
    if (!hasPendingWork()) action();
    else
      void waitForPendingWork().then(
        () => {
          if (current.active && sequence === current.sequence) action();
        },
        (cause) => {
          if (current.active && sequence === current.sequence) onError(errorMessage(cause));
        },
      );
  };
}

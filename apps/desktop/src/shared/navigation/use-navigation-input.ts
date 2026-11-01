import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { registerNavigationInput, type NavigationDirection } from "./navigation-input";

/** Register one active browsing context without retaining callbacks from earlier renders. */
export function useNavigationInput({
  element,
  enabled,
  onNavigate,
}: {
  element: RefObject<HTMLElement | null>;
  enabled: boolean;
  onNavigate: (direction: NavigationDirection) => void;
}) {
  const current = useRef({ enabled, onNavigate });
  useLayoutEffect(() => {
    current.current = { enabled, onNavigate };
  }, [enabled, onNavigate]);
  useEffect(
    () =>
      registerNavigationInput({
        element: () => element.current,
        enabled: () => current.current.enabled,
        onNavigate: (direction) => current.current.onNavigate(direction),
      }),
    [element],
  );
}

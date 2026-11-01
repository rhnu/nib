export type NavigationDirection = "back" | "forward";

/** Match only browser navigation keys; ordinary editing shortcuts stay local. */
export function navigationKey(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): NavigationDirection | undefined {
  if (event.key === "BrowserBack") return "back";
  if (event.key === "BrowserForward") return "forward";
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return undefined;
  if (event.key === "ArrowLeft") return "back";
  if (event.key === "ArrowRight") return "forward";
}

export function navigationButton(button: number): NavigationDirection | undefined {
  if (button === 3) return "back";
  if (button === 4) return "forward";
}

export type NavigationInputScope = {
  element: () => HTMLElement | null;
  enabled: () => boolean;
  onNavigate: (direction: NavigationDirection) => void;
};

const scopes = new Set<NavigationInputScope>();

/** A resource browser explicitly owns navigation while its current context is active. */
export function registerNavigationInput(scope: NavigationInputScope) {
  scopes.add(scope);
  return () => {
    scopes.delete(scope);
  };
}

function dispatchNavigation(direction: NavigationDirection, document: Document) {
  const visible = (element: HTMLElement) =>
    element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true";

  // Select and action-menu portals own input until dismissed, including inside a picker.
  if ([...document.querySelectorAll<HTMLElement>('[role="menu"], [role="listbox"]')].some(visible))
    return;
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'),
  ].filter(visible);
  const dialog = dialogs.at(-1);
  const scope = [...scopes].reverse().find((candidate) => {
    const element = candidate.element();
    return (
      element &&
      candidate.enabled() &&
      element.getClientRects().length > 0 &&
      (!dialog || dialog.contains(element))
    );
  });
  scope?.onNavigate(direction);
}

/** Cancel WebView browser navigation at every mouse phase, dispatching once on release. */
export function installNavigationInput(window: Window) {
  const mouse = (event: MouseEvent) => {
    const direction = navigationButton(event.button);
    if (!direction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "mouseup") dispatchNavigation(direction, window.document);
  };

  const keyboard = (event: KeyboardEvent) => {
    const direction = navigationKey(event);
    if (!direction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "keydown" && !event.repeat) dispatchNavigation(direction, window.document);
  };

  const mouseEvents = ["mousedown", "mouseup", "auxclick"] as const;
  const keyboardEvents = ["keydown", "keyup"] as const;
  for (const event of mouseEvents) window.addEventListener(event, mouse, true);
  for (const event of keyboardEvents) window.addEventListener(event, keyboard, true);
  return () => {
    for (const event of mouseEvents) window.removeEventListener(event, mouse, true);
    for (const event of keyboardEvents) window.removeEventListener(event, keyboard, true);
  };
}

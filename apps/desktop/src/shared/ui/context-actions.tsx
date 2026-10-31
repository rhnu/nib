import { useRef, type ReactElement } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import { ActionMenuItems, type ActionMenuItem } from "./actions-menu";

/** Adds a context entry point to an existing surface without changing its layout. */
export function ContextActions({
  items,
  children,
  onOpen,
  deferToAncestor = false,
}: {
  items: ActionMenuItem[];
  children: ReactElement;
  onOpen?: () => void;
  deferToAncestor?: boolean;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const returnOnEscape = useRef(false);
  return (
    <ContextMenu.Root
      onOpenChange={(open, details) => {
        returnOnEscape.current = !open && details.reason === "escape-key";
        if (open) onOpen?.();
      }}
    >
      <ContextMenu.Trigger
        render={children}
        tabIndex={0}
        data-context-actions={deferToAncestor ? undefined : ""}
        onContextMenu={(event) => {
          const nested = (event.target as Element).closest("[data-context-actions]");
          if (
            (nested && nested !== event.currentTarget && event.currentTarget.contains(nested)) ||
            (deferToAncestor &&
              event.currentTarget.parentElement?.closest("[data-context-actions]"))
          ) {
            (event as typeof event & { preventBaseUIHandler: () => void }).preventBaseUIHandler();
            return;
          }
          returnFocus.current = event.currentTarget;
        }}
        onTouchStart={(event) => {
          if (
            (event.target as Element).closest(
              "input, textarea, [role='textbox'], [contenteditable='true']",
            ) ||
            (deferToAncestor &&
              event.currentTarget.parentElement?.closest("[data-context-actions]"))
          ) {
            (event as typeof event & { preventBaseUIHandler: () => void }).preventBaseUIHandler();
            return;
          }
          returnFocus.current = event.currentTarget;
        }}
        onKeyDown={(event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          const nested = (event.target as Element).closest("[data-context-actions]");
          if (
            (nested && nested !== event.currentTarget && event.currentTarget.contains(nested)) ||
            (deferToAncestor &&
              event.currentTarget.parentElement?.closest("[data-context-actions]"))
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + 8,
              clientY: rect.top + 8,
            }),
          );
        }}
      />
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="menu-positioner">
          <ContextMenu.Popup
            className="menu-popup"
            finalFocus={() => (returnOnEscape.current ? returnFocus.current : false)}
          >
            <ActionMenuItems items={items} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

import { useEffect, useState } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import { t, useTranslation } from "@/shared/i18n";
import { invokeHost, hasDesktopHost } from "@/shared/host/invoke";
import { errorMessage } from "@/shared/host/error";
import { ActionMenuItems, type ActionMenuItem } from "./actions-menu";
import { notify } from "./notifications";

export type TextEditAction = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";
export type TextEditingTarget = {
  element: HTMLElement;
  enabled: Record<TextEditAction, boolean>;
  restore: () => void;
  run: (action: TextEditAction) => void | Promise<void>;
  copyValue?: () => Promise<void>;
};

const editors = new WeakMap<HTMLElement, () => TextEditingTarget>();

/** Editors own their document, selection and history; the menu owns only presentation. */
export function registerTextEditor(element: HTMLElement, target: () => TextEditingTarget) {
  editors.set(element, target);
  return () => {
    editors.delete(element);
  };
}

function editingTarget(element: Element): TextEditingTarget | null {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const editor = editors.get(node as HTMLElement);
    if (editor) return editor();
  }
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.containsNode(element, true)) return null;
    const text = selection.toString();
    if (!text) return null;
    return {
      element: element as HTMLElement,
      enabled: { undo: false, redo: false, cut: false, copy: true, paste: false, selectAll: false },
      restore: () => {},
      run: async (action) => {
        if (action === "copy") await navigator.clipboard.writeText(text);
      },
    };
  }
  if (
    element instanceof HTMLInputElement &&
    !["text", "search", "url", "tel", "email", "password", "number"].includes(element.type)
  )
    return null;
  const field = element;
  const disabled = field.matches(":disabled") || Boolean(field.closest("[inert]"));
  if (!disabled) field.focus({ preventScroll: true });
  const mutable = !disabled && !field.readOnly;
  const password = field instanceof HTMLInputElement && field.type === "password";
  const from = field.selectionStart;
  const to = field.selectionEnd;
  const direction = field.selectionDirection;
  const selectable = from !== null && to !== null;
  const selected = selectable && from !== to && !password;
  const value = field.value;

  const restore = () => {
    if (!field.isConnected) return;
    field.focus({ preventScroll: true });
    if (selectable && field.value === value)
      field.setSelectionRange(from, to, direction ?? undefined);
  };

  return {
    element: field,
    restore,
    enabled: {
      undo: mutable && hasDesktopHost(),
      redo: mutable && hasDesktopHost(),
      cut: mutable && selected && hasDesktopHost(),
      copy: !disabled && selected && hasDesktopHost(),
      paste: mutable && hasDesktopHost(),
      selectAll: !disabled && selectable && value.length > 0,
    },
    run: async (action) => {
      if (!field.isConnected || field.matches(":disabled") || field.closest("[inert]")) return;
      restore();
      if (action === "selectAll") {
        field.select();
        return;
      }
      if (field.value !== value) return;
      if (["undo", "redo", "cut", "paste"].includes(action) && field.readOnly) return;
      if (
        (action === "cut" || action === "copy") &&
        field instanceof HTMLInputElement &&
        field.type === "password"
      )
        return;
      await invokeHost<void>("edit_text", { action });
    },
    copyValue:
      !disabled && field instanceof HTMLInputElement && field.type === "number" && value.length > 0
        ? () => navigator.clipboard.writeText(value)
        : undefined,
  };
}

/** Installed before React renders, including startup, failure screens and portals. */
export function disableDefaultContextMenu() {
  const suppress = (event: MouseEvent) => event.preventDefault();

  document.addEventListener("contextmenu", suppress, true);
  return () => document.removeEventListener("contextmenu", suppress, true);
}

/** A document listener reaches native fields inside every portal and keeps text above object menus. */
export function TextContextMenu() {
  useTranslation();
  const [context, setContext] = useState<{
    target: TextEditingTarget;
    x: number;
    y: number;
  } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent &&
        event.key !== "ContextMenu" &&
        !(event.shiftKey && event.key === "F10")
      )
        return;
      if (!(event.target instanceof Element)) return;
      const target = editingTarget(event.target);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = target.element.getBoundingClientRect();
      setContext({
        target,
        x: event instanceof MouseEvent && event.clientX ? event.clientX : rect.left + 8,
        y: event instanceof MouseEvent && event.clientY ? event.clientY : rect.top + 8,
      });
      setOpen(true);
    };

    document.addEventListener("contextmenu", show, true);
    document.addEventListener("keydown", show, true);
    return () => {
      document.removeEventListener("contextmenu", show, true);
      document.removeEventListener("keydown", show, true);
    };
  }, []);

  const run = (action: TextEditAction) => {
    if (!context?.target.enabled[action]) return;
    const target = context.target;
    setOpen(false);
    requestAnimationFrame(() => {
      Promise.resolve()
        .then(() => target.run(action))
        .catch((cause: unknown) =>
          notify(() => t("common.editFailed", { detail: errorMessage(cause) }), "text-edit", true),
        );
    });
  };

  const actions: TextEditAction[] = ["undo", "redo", "cut", "copy", "paste", "selectAll"];
  const shortcuts = ["Ctrl+Z", "Ctrl+Y", "Ctrl+X", "Ctrl+C", "Ctrl+V", "Ctrl+A"];
  const items: ActionMenuItem[] = actions.flatMap((action, index) => [
    ...([2, 5].includes(index) ? [{ separator: true } as const] : []),
    {
      label: t(`common.${action}`),
      shortcut: shortcuts[index],
      disabled: !context?.target.enabled[action],
      action: () => run(action),
    },
  ]);
  if (context?.target.copyValue)
    items.push({
      label: t("common.copyValue"),
      action: () => {
        context.target.restore();
        void Promise.resolve()
          .then(() => context.target.copyValue?.())
          .catch((cause: unknown) =>
            notify(
              () => t("common.editFailed", { detail: errorMessage(cause) }),
              "text-edit",
              true,
            ),
          );
      },
    });
  return (
    <ContextMenu.Root open={open} onOpenChange={setOpen}>
      <ContextMenu.Portal>
        <ContextMenu.Positioner
          className="menu-positioner"
          anchor={{
            getBoundingClientRect: () =>
              DOMRect.fromRect({ x: context?.x ?? 0, y: context?.y ?? 0 }),
          }}
        >
          <ContextMenu.Popup
            className="menu-popup"
            finalFocus={(interaction) => {
              if (interaction === "keyboard") context?.target.restore();
              return false;
            }}
          >
            <ActionMenuItems items={items} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

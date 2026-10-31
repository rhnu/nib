import type { ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { ChevronRight, MoreHorizontal } from "lucide-react";

export type ActionMenuItem =
  | { label: string; action: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }
  | { separator: true }
  | { label: string; items: ActionMenuItem[]; disabled?: boolean };

/** Both menu entry points share actions, grouping, keyboard hints and submenus. */
export function ActionMenuItems({ items }: { items: ActionMenuItem[] }) {
  return items.map((item, index) => {
    if ("separator" in item) return <Menu.Separator key={index} className="menu-separator" />;
    if ("items" in item)
      return (
        <Menu.SubmenuRoot key={item.label}>
          <Menu.SubmenuTrigger className="menu-item" disabled={item.disabled}>
            <span>{item.label}</span>
            <ChevronRight size={14} aria-hidden />
          </Menu.SubmenuTrigger>
          <Menu.Portal>
            <Menu.Positioner className="menu-positioner" sideOffset={3}>
              <Menu.Popup className="menu-popup">
                <ActionMenuItems items={item.items} />
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.SubmenuRoot>
      );
    return (
      <Menu.Item
        key={item.label}
        className={`menu-item ${item.danger ? "danger" : ""}`}
        disabled={item.disabled}
        onClick={item.action}
      >
        <span>{item.label}</span>
        {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
      </Menu.Item>
    );
  });
}

export function ActionsMenu({
  label,
  items,
  children,
}: {
  label: string;
  children?: ReactNode;
  items: ActionMenuItem[];
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className={children ? undefined : "icon-button"}
        aria-label={label}
        title={label}
      >
        {children ?? <MoreHorizontal size={17} />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={5} align="end" className="menu-positioner">
          <Menu.Popup className="menu-popup">
            <ActionMenuItems items={items} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

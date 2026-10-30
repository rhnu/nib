import type { ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal } from "lucide-react";

export function ActionsMenu({
  label,
  items,
  children,
}: {
  label: string;
  children?: ReactNode;
  items: { label: string; action: () => void; danger?: boolean; disabled?: boolean }[];
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
            {items.map((item) => (
              <Menu.Item
                key={item.label}
                className={`menu-item ${item.danger ? "danger" : ""}`}
                disabled={item.disabled}
                onClick={item.action}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal, X } from "lucide-react";

export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button type="button" className="icon-button" title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup className={`modal ${wide ? "modal-wide" : ""}`}>
          <header className="modal-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="关闭" title="关闭">
              <X size={17} />
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

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

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="toggle" title={label}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
      />
      <span />
    </label>
  );
}

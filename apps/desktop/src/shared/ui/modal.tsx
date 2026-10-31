import { t, useTranslation } from "@/shared/i18n";
import type { ComponentProps, ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
  showClose = true,
  className = "",
  finalFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  showClose?: boolean;
  className?: string;
  finalFocus?: ComponentProps<typeof Dialog.Popup>["finalFocus"];
}) {
  useTranslation();

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop" />
        <Dialog.Popup
          className={`modal ${wide ? "modal-wide" : ""} ${className}`}
          finalFocus={finalFocus}
        >
          <header className="modal-header">
            <Dialog.Title>{title}</Dialog.Title>
            {showClose && (
              <Dialog.Close
                className="icon-button"
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X size={17} />
              </Dialog.Close>
            )}
          </header>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

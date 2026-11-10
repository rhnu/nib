import { buttonStyles, iconButtonStyles } from "../controls/button";
import { uiStyles } from "./styles";
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
  initialFocus,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  showClose?: boolean;
  className?: string;
  finalFocus?: ComponentProps<typeof Dialog.Popup>["finalFocus"];
  initialFocus?: ComponentProps<typeof Dialog.Popup>["initialFocus"];
  actions?: ReactNode;
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
        <Dialog.Backdrop className={`modal-backdrop ${uiStyles["modal-backdrop"]}`} />
        <Dialog.Popup
          className={`modal [&.vibe-encoder-modal]:w-[min(620px,_calc(100vw_-_32px))] [&.vibe-encoder-modal]:p-0 [&.vibe-encoder-modal]:overflow-hidden ${uiStyles["modal"]}  ${wide ? `modal-wide [&_>_.generation-dialog-body]:p-space-4 ${uiStyles["modal-wide"]}` : "[:where(&)]:w-[min(440px,calc(100vw-32px))] [:where(&)]:p-(--space-4) [:where(&)]:overflow-auto"}  ${className}`}
          finalFocus={finalFocus}
          initialFocus={initialFocus}
        >
          <header className={`modal-header ${uiStyles["modal-header"]}`}>
            <Dialog.Title>{title}</Dialog.Title>
            {actions}
            {showClose && (
              <Dialog.Close
                className={`${buttonStyles}  ${iconButtonStyles} icon-button`}
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

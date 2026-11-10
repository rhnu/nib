import { ButtonGroup } from "../layout/stack";

import { uiStyles } from "./styles";
import { useRef, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { t, useTranslation } from "@/shared/i18n";
import { Button, IconButton } from "../controls/button";
import { Modal } from "./modal";

/** Confirm item removal unless the user explicitly bypasses the dialog with Shift. */
export function ConfirmIconButton({
  label,
  description,
  onConfirm,
  children,
}: {
  label: string;
  description: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  useTranslation();

  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton
        ref={trigger}
        label={label}
        title={t("common.deleteWithShift", { label })}
        className={`danger text-danger`}
        onClick={(event) => {
          if (event.shiftKey) onConfirm();
          else setOpen(true);
        }}
      >
        {children}
      </IconButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={label}
        showClose={false}
        initialFocus={cancel}
        finalFocus={trigger}
      >
        <Dialog.Description className={`confirm-copy ${uiStyles["confirm-copy"]}`}>
          {description}
        </Dialog.Description>
        <ButtonGroup
          gap={0}
          className={`dialog-actions flex items-center justify-end flex-wrap gap-space-3 mt-space-4`}
        >
          <Button ref={cancel} onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            className={``}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {t("common.confirmDelete")}
          </Button>
        </ButtonGroup>
      </Modal>
    </>
  );
}

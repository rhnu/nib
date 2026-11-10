import { buttonStyles, iconButtonStyles } from "../controls/button";
import { uiStyles } from "./styles";
import { t, useTranslation } from "@/shared/i18n";
import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { CircleHelp, X } from "lucide-react";

/** On-demand help shares the same pointer, touch and keyboard behavior everywhere. */
export function HelpMarker({
  children,
  label = t("common.help"),
}: {
  children: ReactNode;
  label?: string;
}) {
  useTranslation();

  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`${buttonStyles}  ${iconButtonStyles} icon-button help-marker w-(--control-height-compact) min-h-(--control-height-compact) h-(--control-height-compact) ${uiStyles["help-marker"]}`}
        aria-label={label}
        openOnHover
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
      >
        <CircleHelp size={14} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          sideOffset={6}
          align="end"
          className={`help-positioner ${uiStyles["help-positioner"]}`}
        >
          <Popover.Popup className={`help-popup ${uiStyles["help-popup"]}`} initialFocus={false}>
            <header>
              <Popover.Title>{label}</Popover.Title>
              <Popover.Close
                className={`${buttonStyles}  ${iconButtonStyles} icon-button`}
                aria-label={t("common.closeHelp")}
              >
                <X size={14} aria-hidden />
              </Popover.Close>
            </header>
            <Popover.Description render={<div />}>{children}</Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

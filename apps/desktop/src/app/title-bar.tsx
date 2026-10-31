import { t, useTranslation } from "@/shared/i18n";
import type { ReactNode } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { Button, IconButton, Notice } from "@/shared/ui";
import appIcon from "@/assets/app-icon.svg";
import { useWindowControls } from "./use-window-controls";

/** Application chrome stays available during workspace startup and failures. */
export function TitleBar({ navigation, actions }: { navigation?: ReactNode; actions?: ReactNode }) {
  useTranslation();

  const controls = useWindowControls();
  return (
    <>
      <header className="titlebar" aria-label={t("app.titleBar")}>
        <span className="titlebar-brand">
          <img className="app-icon" src={appIcon} width={22} height={22} alt="" aria-hidden />
          {t("app.brandName")}
        </span>
        {navigation}
        <div
          className="titlebar-drag-region"
          data-tauri-drag-region={controls.desktop || undefined}
        ></div>
        {actions}
        {controls.desktop && (
          <fieldset className="window-controls" aria-label={t("app.windowControls")}>
            <IconButton
              className="window-control"
              label={t("app.minimize")}
              onClick={() => void controls.minimize()}
            >
              <Minus size={15} aria-hidden />
            </IconButton>
            <IconButton
              className="window-control"
              label={controls.maximized ? t("app.restoreWindow") : t("app.maximize")}
              onClick={() => void controls.toggleMaximize()}
            >
              {controls.maximized ? (
                <Copy size={13} aria-hidden />
              ) : (
                <Square size={13} aria-hidden />
              )}
            </IconButton>
            <IconButton
              className="window-control window-close"
              label={t("app.closeWindow")}
              onClick={() => void controls.close()}
            >
              <X size={17} aria-hidden />
            </IconButton>
          </fieldset>
        )}
      </header>
      {controls.error && (
        <Notice actions={<Button onClick={controls.clearError}>{t("app.dismissNotice")}</Button>}>
          {controls.error}
        </Notice>
      )}
    </>
  );
}

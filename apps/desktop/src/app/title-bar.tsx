import { Button, IconButton, Notice, Row } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import type { ReactNode } from "react";
import { Copy, Minus, Square, X } from "lucide-react";

import appIcon from "@/assets/app-icon.svg";
import { useWindowControls } from "./use-window-controls";

/** Application chrome stays available during workspace startup and failures. */
export function TitleBar({ navigation, actions }: { navigation?: ReactNode; actions?: ReactNode }) {
  useTranslation();

  const controls = useWindowControls();
  return (
    <>
      <Row
        gap={0}
        align="center"
        as="header"
        className="titlebar relative [z-index:60] shrink-0 [height:var(--titlebar-height)] [border-bottom:1px_solid_var(--line)] bg-panel select-none"
        aria-label={t("app.titleBar")}
      >
        <Row
          gap={3}
          align="center"
          as="span"
          className="titlebar-brand shrink-0 py-0 px-[18px] [font-size:18px] [font-weight:650] [letter-spacing:-0.5px] max-[580px]:px-[10px]"
        >
          <img className="app-icon" src={appIcon} width={22} height={22} alt="" aria-hidden />
          {t("app.brandName")}
        </Row>
        {navigation}
        <div
          className="titlebar-drag-region [align-self:stretch] flex-1 min-w-0"
          data-tauri-drag-region={controls.desktop || undefined}
        ></div>
        {actions}
        {controls.desktop && (
          <Row
            gap={0}
            align="stretch"
            as="fieldset"
            className="window-controls [align-self:stretch]"
            aria-label={t("app.windowControls")}
          >
            <IconButton
              className="window-control [width:46px] h-full min-h-0 p-0 [border:0] [border-radius:0] cursor-default [&:focus-visible]:[outline-offset:-3px] max-[580px]:[width:34px]"
              label={t("app.minimize")}
              onClick={() => void controls.minimize()}
            >
              <Minus size={15} aria-hidden />
            </IconButton>
            <IconButton
              className="window-control [width:46px] h-full min-h-0 p-0 [border:0] [border-radius:0] cursor-default [&:focus-visible]:[outline-offset:-3px] max-[580px]:[width:34px]"
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
              className="window-control [width:46px] h-full min-h-0 p-0 [border:0] [border-radius:0] cursor-default [&:focus-visible]:[outline-offset:-3px] max-[580px]:[width:34px] window-close [&:hover:not(:disabled)]:[background:#c42b1c] [&:hover:not(:disabled)]:[color:#fff]"
              label={t("app.closeWindow")}
              onClick={() => void controls.close()}
            >
              <X size={17} aria-hidden />
            </IconButton>
          </Row>
        )}
      </Row>
      {controls.error && (
        <Notice actions={<Button onClick={controls.clearError}>{t("app.dismissNotice")}</Button>}>
          {controls.error}
        </Notice>
      )}
    </>
  );
}

import type { ReactNode } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { Button, IconButton, Notice } from "@/shared/ui";
import { useWindowControls } from "./use-window-controls";

/** Application chrome stays available during workspace startup and failures. */
export function TitleBar({ navigation }: { navigation?: ReactNode }) {
  const controls = useWindowControls();
  return (
    <>
      <header className="titlebar" aria-label="窗口标题栏">
        <span className="titlebar-brand">nib</span>
        {navigation}
        <div
          className="titlebar-drag-region"
          data-tauri-drag-region={controls.desktop || undefined}
        ></div>
        {controls.desktop && (
          <fieldset className="window-controls" aria-label="窗口控制">
            <IconButton
              className="window-control"
              label="最小化"
              onClick={() => void controls.minimize()}
            >
              <Minus size={15} aria-hidden />
            </IconButton>
            <IconButton
              className="window-control"
              label={controls.maximized ? "还原窗口" : "最大化"}
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
              label="关闭窗口"
              onClick={() => void controls.close()}
            >
              <X size={17} aria-hidden />
            </IconButton>
          </fieldset>
        )}
      </header>
      {controls.error && (
        <Notice actions={<Button onClick={controls.clearError}>关闭提示</Button>}>
          {controls.error}
        </Notice>
      )}
    </>
  );
}

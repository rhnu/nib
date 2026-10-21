import { Copy, Minus, Moon, Square, Sun, X } from "lucide-react";
import { Button, IconButton, Notice } from "../shared/ui";
import { useWindowControls } from "./useWindowControls";

/** Application chrome stays available during workspace startup and failures. */
export function TitleBar({
  theme,
  toggleTheme,
  workspaceOpen,
}: {
  theme: string;
  toggleTheme: () => void;
  workspaceOpen: boolean;
}) {
  const controls = useWindowControls();
  return (
    <>
      <header className="titlebar" aria-label="窗口标题栏">
        <div
          className="titlebar-drag-region"
          data-tauri-drag-region={controls.desktop || undefined}
        >
          <span className="titlebar-brand">nib</span>
          <span className="titlebar-divider" />
          <span className="titlebar-caption">{workspaceOpen ? "当前创作" : "本地创作工作台"}</span>
        </div>
        <div className="titlebar-tools">
          <IconButton
            label={theme === "dark" ? "切换浅色主题" : "切换深色主题"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
          </IconButton>
        </div>
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

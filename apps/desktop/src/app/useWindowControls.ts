import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasDesktopHost } from "../shared/host/invoke";
import { errorMessage } from "../shared/host/error";

/** Keep the title bar in sync with native resize, snap, and maximize operations. */
export function useWindowControls() {
  const desktop = hasDesktopHost();
  const [maximized, setMaximized] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!desktop) return;
    const appWindow = getCurrentWindow();
    let stopped = false;
    let unlisten: (() => void) | undefined;
    const reportError = (cause: unknown) => {
      if (!stopped) setError(`无法读取窗口状态：${errorMessage(cause)}`);
    };
    const refresh = async () => {
      try {
        const value = await appWindow.isMaximized();
        if (!stopped) setMaximized(value);
      } catch (cause) {
        reportError(cause);
      }
    };
    void appWindow
      .onResized(() => void refresh())
      .then((off) => {
        if (stopped) off();
        else unlisten = off;
      }, reportError);
    void refresh();
    return () => {
      stopped = true;
      unlisten?.();
    };
  }, [desktop]);

  const run = async (action: () => Promise<void>) => {
    if (!desktop) return;
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(`窗口操作失败：${errorMessage(cause)}`);
    }
  };

  return {
    desktop,
    maximized,
    error,
    clearError: () => setError(""),
    minimize: () => run(() => getCurrentWindow().minimize()),
    toggleMaximize: () =>
      run(async () => {
        const appWindow = getCurrentWindow();
        await appWindow.toggleMaximize();
        setMaximized(await appWindow.isMaximized());
      }),
    // close() emits the request handled by useCloseGuard; destroy() would bypass saving.
    close: () => run(() => getCurrentWindow().close()),
  };
}

import { useEffect, useLayoutEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasDesktopHost } from "./invoke";
import { errorMessage } from "./error";
export type CloseWriter = { getSnapshot: () => { dirty: boolean }; flush: () => Promise<void> };
/** Resource editing blocks close; live draft writes must finish before native destruction. */
export function useCloseGuard({
  writer,
  resourceDirty,
  onResourceBlocked,
  onError,
  enabled = true,
  beforeClose,
}: {
  writer: CloseWriter;
  resourceDirty: boolean;
  onResourceBlocked: () => void;
  onError: (message: string) => void;
  enabled?: boolean;
  beforeClose?: () => Promise<boolean>;
}) {
  const latest = useRef({ resourceDirty, onResourceBlocked, onError, beforeClose });
  useLayoutEffect(() => {
    latest.current = { resourceDirty, onResourceBlocked, onError, beforeClose };
  });
  useEffect(() => {
    if (!enabled) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (writer.getSnapshot().dirty || latest.current.resourceDirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    if (!hasDesktopHost()) return () => window.removeEventListener("beforeunload", beforeUnload);
    let stopped = false;
    let unlisten: (() => void) | undefined;
    let closing = false;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        if (latest.current.resourceDirty) {
          latest.current.onResourceBlocked();
          return;
        }
        closing = true;
        try {
          if (latest.current.beforeClose && !(await latest.current.beforeClose())) return;
          await writer.flush();
          if (latest.current.resourceDirty) {
            latest.current.onResourceBlocked();
            return;
          }
          await getCurrentWindow().destroy();
        } catch (cause) {
          latest.current.onError(`窗口未关闭，仍有内容或设置未保存：${errorMessage(cause)}`);
        } finally {
          closing = false;
        }
      })
      .then(
        (off) => {
          if (stopped) off();
          else unlisten = off;
        },
        (cause) => latest.current.onError(errorMessage(cause)),
      );
    return () => {
      stopped = true;
      unlisten?.();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [writer, enabled]);
}

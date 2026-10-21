import { useEffect, useLayoutEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasDesktopHost } from "./invoke";
import { errorMessage } from "./error";
/** Resource editing blocks close; live draft writes must finish before native destruction. */
export function useCloseGuard({
  writer,
  resourceDirty,
  onResourceBlocked,
  onError,
}: {
  writer: { getSnapshot: () => { dirty: boolean }; flush: () => Promise<void> };
  resourceDirty: boolean;
  onResourceBlocked: () => void;
  onError: (message: string) => void;
}) {
  const latest = useRef({ resourceDirty, onResourceBlocked, onError });
  useLayoutEffect(() => {
    latest.current = { resourceDirty, onResourceBlocked, onError };
  });
  useEffect(() => {
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
          await writer.flush();
          if (latest.current.resourceDirty) {
            latest.current.onResourceBlocked();
            return;
          }
          await getCurrentWindow().destroy();
        } catch (cause) {
          latest.current.onError(`窗口未关闭，当前创作仍保留在编辑器中：${errorMessage(cause)}`);
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
  }, [writer]);
}

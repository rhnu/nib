import { t, deferMessage } from "@/shared/i18n";
import { useEffect, useLayoutEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasDesktopHost } from "./invoke";
import { errorMessage } from "./error";

export type CloseWriter = { getSnapshot: () => { dirty: boolean }; flush: () => Promise<void> };

/** Resource editing blocks close; live draft writes must finish before native destruction. */
export function useCloseGuard({
  writer,
  resourceDirty,
  getResourceDirty,
  onResourceBlocked,
  onError,
  enabled = true,
  beforeClose,
}: {
  writer: CloseWriter;
  resourceDirty: boolean;
  getResourceDirty?: () => boolean;
  onResourceBlocked: () => void;
  onError: (message: unknown) => void;
  enabled?: boolean;
  beforeClose?: () => Promise<boolean>;
}) {
  const latest = useRef({
    resourceDirty,
    getResourceDirty,
    onResourceBlocked,
    onError,
    beforeClose,
  });
  useLayoutEffect(() => {
    latest.current = { resourceDirty, getResourceDirty, onResourceBlocked, onError, beforeClose };
  });
  useEffect(() => {
    if (!enabled) return;

    const isResourceDirty = () =>
      latest.current.getResourceDirty?.() ?? latest.current.resourceDirty;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (writer.getSnapshot().dirty || isResourceDirty()) event.preventDefault();
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
        if (isResourceDirty()) {
          latest.current.onResourceBlocked();
          return;
        }
        closing = true;
        try {
          if (latest.current.beforeClose && !(await latest.current.beforeClose())) return;
          await writer.flush();
          if (isResourceDirty()) {
            latest.current.onResourceBlocked();
            return;
          }
          await getCurrentWindow().destroy();
        } catch (cause) {
          latest.current.onError(
            deferMessage(() => t("common.closeBlocked", { value0: errorMessage(cause) })),
          );
        } finally {
          closing = false;
        }
      })
      .then(
        (off) => {
          if (stopped) off();
          else unlisten = off;
        },
        (cause) => latest.current.onError(cause),
      );
    return () => {
      stopped = true;
      unlisten?.();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [writer, enabled]);
}

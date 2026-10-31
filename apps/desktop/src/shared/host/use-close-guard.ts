import { t, deferMessage } from "@/shared/i18n";
import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { hasDesktopHost } from "./invoke";
import { errorMessage } from "./error";
import { ExitPreparationContext, type ExitPreparation } from "./exit-preparation";

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
  exitPreparation,
}: {
  writer: CloseWriter;
  resourceDirty: boolean;
  getResourceDirty?: () => boolean;
  onResourceBlocked: () => void;
  onError: (message: unknown) => void;
  enabled?: boolean;
  beforeClose?: () => Promise<boolean>;
  exitPreparation?: ExitPreparation;
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
  const contextPreparation = useContext(ExitPreparationContext);
  const preparation = exitPreparation ?? contextPreparation;

  const prepare = useCallback(async () => {
    const isResourceDirty = () =>
      latest.current.getResourceDirty?.() ?? latest.current.resourceDirty;

    if (isResourceDirty()) {
      latest.current.onResourceBlocked();
      return false;
    }
    try {
      if (latest.current.beforeClose && !(await latest.current.beforeClose())) return false;
      await writer.flush();
      if (isResourceDirty()) {
        latest.current.onResourceBlocked();
        return false;
      }
      return true;
    } catch (cause) {
      latest.current.onError(
        deferMessage(() => t("common.closeBlocked", { value0: errorMessage(cause) })),
      );
      return false;
    }
  }, [writer]);

  useLayoutEffect(() => {
    if (!enabled || !preparation) return;
    return preparation.register(prepare);
  }, [enabled, preparation, prepare]);
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
        closing = true;
        try {
          if (!(await prepare())) return;
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
  }, [writer, enabled, prepare]);
}

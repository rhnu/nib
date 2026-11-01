import { useContext, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import type { MediaAsset } from "@/bindings/media";
import { WriteAccessContext } from "@/shared/host/write-access";
import { trackPendingWork } from "@/shared/host/pending-work";
import { deferMessage, t, useMessageState } from "@/shared/i18n";
import { acceptsImageDrop, droppedImage } from "./image-drop";
import { mediaApi } from "./api";

/** Page capture handlers precede nested input drop zones and ignore internal resource drags. */
export function useImageDrop({
  onImported,
  contextKey,
}: {
  onImported: (asset: MediaAsset) => void | Promise<void>;
  contextKey: string;
}) {
  const access = useContext(WriteAccessContext);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useMessageState();
  const lifetime = useRef({
    active: true,
    locked: false,
    contextKey,
    revision: 0,
    onImported,
    access,
  });
  useLayoutEffect(() => {
    if (lifetime.current.contextKey !== contextKey) lifetime.current.revision += 1;
    Object.assign(lifetime.current, { contextKey, onImported, access });
  });
  useLayoutEffect(() => {
    const current = lifetime.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);

  // React portals propagate through this component tree; modal drop zones own their own imports.
  const handles = (event: DragEvent) =>
    event.target instanceof Node &&
    event.currentTarget.contains(event.target) &&
    acceptsImageDrop(event.dataTransfer.types);

  const drop = (event: DragEvent) => {
    if (!handles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (lifetime.current.locked || !access.canCommit()) return;
    const input = droppedImage(event.dataTransfer);
    if (!input) {
      setError(deferMessage(() => t("media.dropSingleImage")));
      return;
    }
    lifetime.current.locked = true;
    setBusy(true);
    setError(null);
    const revision = lifetime.current.revision;

    const current = () =>
      lifetime.current.active &&
      lifetime.current.revision === revision &&
      lifetime.current.access.canCommit();

    void trackPendingWork(
      (async () => {
        let asset: MediaAsset;
        if (input.kind === "file") {
          const bytes = Array.from(new Uint8Array(await input.file.arrayBuffer()));
          if (!current()) return;
          asset = await mediaApi.importImage(bytes, input.file.name);
        } else asset = await mediaApi.importRemoteImage(input.url);
        if (current()) await lifetime.current.onImported(asset);
      })(),
    )
      .catch((cause: unknown) => {
        if (current()) setError(cause);
      })
      .finally(() => {
        lifetime.current.locked = false;
        if (lifetime.current.active) setBusy(false);
      });
  };

  return {
    dragging,
    busy,
    error,
    clearError: () => setError(null),
    bindings: {
      onDragOverCapture: (event: DragEvent) => {
        if (!handles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = busy || !access.allowed ? "none" : "copy";
        if (!busy && access.allowed) setDragging(true);
      },
      onDragLeaveCapture: (event: DragEvent) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setDragging(false);
      },
      onDropCapture: drop,
    },
  };
}

import { t, useTranslation, useMessageState, MessageError, deferMessage } from "@/shared/i18n";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Eraser, Hand, Minus, Paintbrush, Plus, Redo2, RotateCcw, Undo2 } from "lucide-react";
import type { MaskPoint, MaskSession } from "@/bindings/workbench";
import { Button, HelpMarker, IconButton, Notice } from "@/shared/ui";
import {
  appendCommand,
  appendStrokePoints,
  canvasTransform,
  nativePoint,
  overlayMaskPixels,
  redoMask,
  undoMask,
  zoomAt,
} from "./model";
import { drawMask } from "./raster";
import { useMaskBitmaps } from "./use-mask-bitmaps";
import { ImageContextActions } from "@/features/media/image-context-actions";
import { useMediaAsset } from "@/features/media/use-media-asset";
import "./inpaint.css";

type Tool = "paint" | "erase" | "pan";
type Preview = "overlay" | "original" | "mask";
type Gesture =
  | { pointerId: number; kind: "stroke"; commandIndex: number }
  | { pointerId: number; kind: "pan"; start: MaskPoint; panX: number; panY: number };

export function InpaintCanvasWorkspace({
  value,
  onChange,
  onApply,
  onClose,
  onDiscard,
  pending = false,
  error,
}: {
  value: MaskSession;
  onChange: (session: MaskSession) => void;
  onApply: () => void;
  onClose: () => void;
  onDiscard: () => void;
  pending?: boolean;
  error?: string | null;
}) {
  useTranslation();

  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [size, setSize] = useState({ width: 640, height: 480 });
  const [tool, setTool] = useState<Tool>("paint");
  const [preview, setPreview] = useState<Preview>("overlay");
  const [pointer, setPointer] = useState<MaskPoint | null>(null);
  const [renderError, setRenderError] = useMessageState();
  const images = useMaskBitmaps(value.sourceAssetId, value.baseMaskAssetId);
  const source = useMediaAsset(value.sourceAssetId);
  const { width, height, commands, cursor } = value;
  const raster = useRef<{
    width: number;
    height: number;
    commands: MaskSession["commands"];
    cursor: number;
    base: ImageBitmap | null;
    mask: HTMLCanvasElement;
    overlay: HTMLCanvasElement;
  } | null>(null);
  const latest = useRef({ value, onChange, pending, size });
  useLayoutEffect(() => {
    if (latest.current.value.sourceAssetId !== value.sourceAssetId) {
      const previous = gesture.current;
      gesture.current = null;
      if (previous && viewport.current?.hasPointerCapture(previous.pointerId))
        viewport.current.releasePointerCapture(previous.pointerId);
    }
    latest.current = { value, onChange, pending, size };
  }, [value, onChange, pending, size]);
  useLayoutEffect(() => {
    if (!pending && preview !== "original") return;
    const previous = gesture.current;
    gesture.current = null;
    if (previous && viewport.current?.hasPointerCapture(previous.pointerId))
      viewport.current.releasePointerCapture(previous.pointerId);
  }, [pending, preview]);

  const change = (next: MaskSession) => {
    if (latest.current.pending) return;
    latest.current.value = next;
    latest.current.onChange(next);
  };

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (latest.current.pending || gesture.current) return;
      const bounds = element.getBoundingClientRect();
      const current = latest.current;
      const next = zoomAt(
        current.value,
        current.size,
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        current.value.zoom * (event.deltaY > 0 ? 0.9 : 1.1),
      );
      current.value = next;
      current.onChange(next);
    };

    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const target = canvas.current;
    const source = images.source;
    if (!target || !source) return;
    const frame = requestAnimationFrame(() => {
      try {
        if (source.width !== width || source.height !== height)
          throw new MessageError(deferMessage(() => t("inpaint.sessionSizeMismatch")));
        const context = target.getContext("2d");
        if (!context) throw new MessageError(deferMessage(() => t("inpaint.previewFailed")));
        target.width = width;
        target.height = height;
        context.drawImage(source, 0, 0);
        if (preview !== "original") {
          let cached = raster.current;
          if (
            !cached ||
            cached.width !== width ||
            cached.height !== height ||
            cached.commands !== commands ||
            cached.cursor !== cursor ||
            cached.base !== images.mask
          ) {
            const mask = drawMask({ width, height, commands, cursor }, images.mask);
            const overlay = document.createElement("canvas");
            overlay.width = width;
            overlay.height = height;
            const overlayContext = overlay.getContext("2d");
            if (!overlayContext)
              throw new MessageError(deferMessage(() => t("inpaint.overlayCanvasFailed")));
            const pixels = mask.getContext("2d")!.getImageData(0, 0, width, height);
            pixels.data.set(overlayMaskPixels(pixels.data));
            overlayContext.putImageData(pixels, 0, 0);
            cached = { width, height, commands, cursor, base: images.mask, mask, overlay };
            raster.current = cached;
          }
          context.drawImage(preview === "overlay" ? cached.overlay : cached.mask, 0, 0);
        }
        setRenderError(null);
      } catch (cause) {
        setRenderError(cause);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [width, height, commands, cursor, preview, images.source, images.mask, setRenderError]);

  const transform = canvasTransform(value, size);
  const ready =
    !!images.source &&
    images.source.width === value.width &&
    images.source.height === value.height &&
    !images.error &&
    !renderError &&
    !pending;

  const eventPoint = (event: { clientX: number; clientY: number }) => {
    const bounds = viewport.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const stop = (element: HTMLDivElement, pointerId?: number) => {
    const current = gesture.current;
    if (pointerId !== undefined && current?.pointerId !== pointerId) return;
    gesture.current = null;
    if (current && element.hasPointerCapture(current.pointerId))
      element.releasePointerCapture(current.pointerId);
  };

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (!ready || gesture.current || (event.button !== 0 && event.button !== 1)) return;
    const screen = eventPoint(event);
    const current = latest.current.value;
    const point = nativePoint(screen, canvasTransform(current, latest.current.size));
    const pan = tool === "pan" || event.button === 1;
    if (
      !pan &&
      (preview === "original" ||
        point.x < 0 ||
        point.y < 0 ||
        point.x > current.width ||
        point.y > current.height)
    )
      return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pan)
      gesture.current = {
        pointerId: event.pointerId,
        kind: "pan",
        start: screen,
        panX: current.panX,
        panY: current.panY,
      };
    else {
      const next = appendCommand(current, {
        kind: tool === "erase" ? "erase" : "paint",
        size: current.brushSize,
        points: [point],
      });
      gesture.current = {
        pointerId: event.pointerId,
        kind: "stroke",
        commandIndex: next.cursor - 1,
      };
      change(next);
    }
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const screen = eventPoint(event);
    setPointer(screen);
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || latest.current.pending) return;
    event.preventDefault();
    if (current.kind === "pan") {
      change({
        ...latest.current.value,
        panX: current.panX + screen.x - current.start.x,
        panY: current.panY + screen.y - current.start.y,
      });
    } else {
      const session = latest.current.value;
      const transform = canvasTransform(session, latest.current.size);
      const events = event.nativeEvent.getCoalescedEvents?.();
      const points = (events?.length ? events : [event]).map((sample) =>
        nativePoint(eventPoint(sample), transform),
      );
      const next = appendStrokePoints(session, current.commandIndex, points);
      if (next !== latest.current.value) change(next);
    }
  };

  const zoom = (factor: number) => {
    if (viewport.current) stop(viewport.current);
    change(
      zoomAt(
        latest.current.value,
        size,
        { x: size.width / 2, y: size.height / 2 },
        latest.current.value.zoom * factor,
      ),
    );
  };

  const chooseTool = (next: Tool) => {
    if (viewport.current) stop(viewport.current);
    if (next !== "pan" && preview === "original") setPreview("overlay");
    setTool(next);
  };

  const runHistory = (action: (session: MaskSession) => MaskSession) => {
    if (viewport.current) stop(viewport.current);
    change(action(latest.current.value));
  };

  return (
    <section
      className="inpaint-workspace"
      aria-label={t("inpaint.editorTitle")}
      aria-busy={pending}
    >
      <header className="inpaint-toolbar">
        <div className="button-group">
          <Button
            aria-pressed={tool === "paint"}
            disabled={pending}
            onClick={() => chooseTool("paint")}
          >
            <Paintbrush size={14} />
            {t("inpaint.draw")}
          </Button>
          <Button
            aria-pressed={tool === "erase"}
            disabled={pending}
            onClick={() => chooseTool("erase")}
          >
            <Eraser size={14} />
            {t("inpaint.erase")}
          </Button>
          <Button
            aria-pressed={tool === "pan"}
            disabled={pending}
            onClick={() => chooseTool("pan")}
          >
            <Hand size={14} />
            {t("inpaint.pan")}
          </Button>
        </div>
        <label className="inpaint-brush">
          <span>
            {t("inpaint.brushPrefix")}
            {value.brushSize}
            {t("inpaint.pixels")}
          </span>
          <input
            type="range"
            min={1}
            max={512}
            step={1}
            value={value.brushSize}
            disabled={pending}
            onChange={(event) =>
              change({ ...latest.current.value, brushSize: Number(event.target.value) })
            }
          />
        </label>
        <div className="button-group">
          <IconButton
            label={t("inpaint.undo")}
            disabled={pending || value.cursor === 0}
            onClick={() => runHistory(undoMask)}
          >
            <Undo2 size={15} />
          </IconButton>
          <IconButton
            label={t("inpaint.redo")}
            disabled={pending || value.cursor === value.commands.length}
            onClick={() => runHistory(redoMask)}
          >
            <Redo2 size={15} />
          </IconButton>
          <Button
            disabled={pending}
            onClick={() => runHistory((session) => appendCommand(session, { kind: "clear" }))}
          >
            {t("inpaint.clear")}
          </Button>
        </div>
        <HelpMarker label={t("inpaint.canvasActions")}>{t("inpaint.canvasHelp")}</HelpMarker>
      </header>
      <div className="inpaint-view-toolbar">
        <label>
          <span>{t("inpaint.preview")}</span>
          <select
            value={preview}
            disabled={pending}
            onChange={(event) => {
              const next = event.target.value as Preview;
              if (viewport.current) stop(viewport.current);
              setPreview(next);
              if (next === "original") setTool("pan");
            }}
          >
            <option value="overlay">{t("inpaint.overlay")}</option>
            <option value="original">{t("inpaint.original")}</option>
            <option value="mask">{t("inpaint.blackWhiteMask")}</option>
          </select>
        </label>
        <div className="button-group">
          <IconButton label={t("inpaint.zoomOut")} disabled={pending} onClick={() => zoom(0.8)}>
            <Minus size={15} />
          </IconButton>
          <output>{Math.round(transform.scale * 100)}%</output>
          <IconButton label={t("inpaint.zoomIn")} disabled={pending} onClick={() => zoom(1.25)}>
            <Plus size={15} />
          </IconButton>
          <Button
            disabled={pending}
            onClick={() => change({ ...latest.current.value, zoom: 1, panX: 0, panY: 0 })}
          >
            <RotateCcw size={14} />
            {t("inpaint.fitCanvas")}
          </Button>
        </div>
        <span className="muted">
          {value.width} × {value.height}
        </span>
      </div>
      {(images.error || renderError) && (
        <Notice actions={<Button onClick={images.retry}>{t("inpaint.retryLoad")}</Button>}>
          {images.error ?? renderError}
        </Notice>
      )}
      {/* The two-dimensional paint surface implements its own pointer and keyboard interaction. */}
      {/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        ref={viewport}
        className={`inpaint-viewport tool-${tool}`}
        role="application"
        aria-label={t("inpaint.canvasLabel")}
        tabIndex={0}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={(event) => {
          move(event);
          stop(event.currentTarget, event.pointerId);
        }}
        onPointerCancel={(event) => stop(event.currentTarget, event.pointerId)}
        onLostPointerCapture={(event) => stop(event.currentTarget, event.pointerId)}
        onPointerLeave={() => {
          if (!gesture.current) setPointer(null);
        }}
        onKeyDown={(event) => {
          if (pending) return;
          const current = latest.current.value;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault();
            runHistory(event.shiftKey ? redoMask : undoMask);
          } else if (event.key === "+" || event.key === "=" || event.key === "-") {
            event.preventDefault();
            zoom(event.key === "-" ? 0.8 : 1.25);
          } else if (event.key.startsWith("Arrow")) {
            event.preventDefault();
            if (viewport.current) stop(viewport.current);
            const distance = event.shiftKey ? 100 : 25;
            change({
              ...current,
              panX:
                current.panX +
                (event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0),
              panY:
                current.panY +
                (event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0),
            });
          }
        }}
      >
        {images.loading && (
          <output className="inpaint-loading">{t("inpaint.loadingSourceMask")}</output>
        )}
        <ImageContextActions
          id={value.sourceAssetId}
          mimeType={source.asset?.mimeType ?? "image/png"}
          available={Boolean(images.source)}
          extraItems={[
            { separator: true },
            {
              label: t("inpaint.undo"),
              shortcut: "Ctrl+Z",
              disabled: pending || value.cursor === 0,
              action: () => runHistory(undoMask),
            },
            {
              label: t("inpaint.redo"),
              shortcut: "Ctrl+Shift+Z",
              disabled: pending || value.cursor === value.commands.length,
              action: () => runHistory(redoMask),
            },
          ]}
        >
          <canvas
            ref={canvas}
            aria-label={
              preview === "original" ? t("inpaint.originalPreview") : t("inpaint.inpaintMask")
            }
            tabIndex={0}
            style={{
              width: value.width * transform.scale,
              height: value.height * transform.scale,
              left: transform.x,
              top: transform.y,
              visibility: images.source ? "visible" : "hidden",
            }}
          />
        </ImageContextActions>
        {ready && pointer && tool !== "pan" && preview !== "original" && (
          <span
            className="inpaint-brush-cursor"
            style={{
              left: pointer.x,
              top: pointer.y,
              width: value.brushSize * transform.scale,
              height: value.brushSize * transform.scale,
            }}
          />
        )}
      </div>
      {/* oxlint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <footer className="inpaint-footer">
        <div>
          {value.revision !== value.appliedRevision && (
            <span className="muted">{t("inpaint.unappliedChanges")}</span>
          )}
          {error && <Notice>{error}</Notice>}
        </div>
        <div className="button-group">
          <Button disabled={pending} onClick={onClose}>
            {t("inpaint.exitEditor")}
          </Button>
          <Button className="danger" disabled={pending} onClick={onDiscard}>
            {t("inpaint.discardChanges")}
          </Button>
          <Button className="primary" disabled={!ready} onClick={onApply}>
            {pending ? t("inpaint.applying") : t("inpaint.apply")}
          </Button>
        </div>
      </footer>
    </section>
  );
}

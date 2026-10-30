import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Eraser, Hand, Minus, Paintbrush, Plus, Redo2, RotateCcw, Undo2 } from "lucide-react";
import type { MaskPoint, MaskSession } from "@/bindings/workbench";
import { errorMessage } from "@/shared/host/error";
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
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [size, setSize] = useState({ width: 640, height: 480 });
  const [tool, setTool] = useState<Tool>("paint");
  const [preview, setPreview] = useState<Preview>("overlay");
  const [pointer, setPointer] = useState<MaskPoint | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const images = useMaskBitmaps(value.sourceAssetId, value.baseMaskAssetId);
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
          throw new Error("遮罩会话尺寸与底图原生尺寸不一致，请重新打开编辑器。");
        const context = target.getContext("2d");
        if (!context) throw new Error("无法绘制遮罩预览，请重试读取底图。");
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
            if (!overlayContext) throw new Error("无法创建遮罩叠加画布。");
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
        setRenderError(errorMessage(cause));
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [width, height, commands, cursor, preview, images.source, images.mask]);

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
    <section className="inpaint-workspace" aria-label="局部重绘遮罩编辑器" aria-busy={pending}>
      <header className="inpaint-toolbar">
        <div className="button-group">
          <Button
            aria-pressed={tool === "paint"}
            disabled={pending}
            onClick={() => chooseTool("paint")}
          >
            <Paintbrush size={14} />
            绘制
          </Button>
          <Button
            aria-pressed={tool === "erase"}
            disabled={pending}
            onClick={() => chooseTool("erase")}
          >
            <Eraser size={14} />
            擦除
          </Button>
          <Button
            aria-pressed={tool === "pan"}
            disabled={pending}
            onClick={() => chooseTool("pan")}
          >
            <Hand size={14} />
            平移
          </Button>
        </div>
        <label className="inpaint-brush">
          <span>笔刷 {value.brushSize}px</span>
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
            label="撤回遮罩操作"
            disabled={pending || value.cursor === 0}
            onClick={() => runHistory(undoMask)}
          >
            <Undo2 size={15} />
          </IconButton>
          <IconButton
            label="重做遮罩操作"
            disabled={pending || value.cursor === value.commands.length}
            onClick={() => runHistory(redoMask)}
          >
            <Redo2 size={15} />
          </IconButton>
          <Button
            disabled={pending}
            onClick={() => runHistory((session) => appendCommand(session, { kind: "clear" }))}
          >
            清除遮罩
          </Button>
        </div>
        <HelpMarker label="遮罩与画布操作">
          白色区域重绘，黑色区域保留。叠加颜色仅用于预览。滚轮缩放；平移工具或鼠标中键拖动。聚焦画布后可用方向键平移、+
          / - 缩放、Ctrl+Z 撤回。
        </HelpMarker>
      </header>
      <div className="inpaint-view-toolbar">
        <label>
          <span>预览</span>
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
            <option value="overlay">叠加遮罩</option>
            <option value="original">原图</option>
            <option value="mask">黑白遮罩</option>
          </select>
        </label>
        <div className="button-group">
          <IconButton label="缩小画布" disabled={pending} onClick={() => zoom(0.8)}>
            <Minus size={15} />
          </IconButton>
          <output>{Math.round(transform.scale * 100)}%</output>
          <IconButton label="放大画布" disabled={pending} onClick={() => zoom(1.25)}>
            <Plus size={15} />
          </IconButton>
          <Button
            disabled={pending}
            onClick={() => change({ ...latest.current.value, zoom: 1, panX: 0, panY: 0 })}
          >
            <RotateCcw size={14} />
            适应画布
          </Button>
        </div>
        <span className="muted">
          {value.width} × {value.height}
        </span>
      </div>
      {(images.error || renderError) && (
        <Notice actions={<Button onClick={images.retry}>重试读取</Button>}>
          {images.error ?? renderError}
        </Notice>
      )}
      {/* The two-dimensional paint surface implements its own pointer and keyboard interaction. */}
      {/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      <div
        ref={viewport}
        className={`inpaint-viewport tool-${tool}`}
        role="application"
        aria-label="遮罩画布。方向键平移，加减键缩放。"
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
        {images.loading && <output className="inpaint-loading">正在读取底图与遮罩…</output>}
        <canvas
          ref={canvas}
          aria-label={preview === "original" ? "原图预览" : "局部重绘遮罩"}
          style={{
            width: value.width * transform.scale,
            height: value.height * transform.scale,
            left: transform.x,
            top: transform.y,
            visibility: images.source ? "visible" : "hidden",
          }}
        />
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
            <span className="muted">遮罩有未应用修改</span>
          )}
          {error && <Notice>{error}</Notice>}
        </div>
        <div className="button-group">
          <Button disabled={pending} onClick={onClose}>
            退出遮罩
          </Button>
          <Button className="danger" disabled={pending} onClick={onDiscard}>
            放弃修改
          </Button>
          <Button className="primary" disabled={!ready} onClick={onApply}>
            {pending ? "正在应用…" : "应用遮罩"}
          </Button>
        </div>
      </footer>
    </section>
  );
}

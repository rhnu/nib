import type { MaskCommand, MaskPoint, MaskSession } from "../../bindings/workbench";

export type Viewport = { width: number; height: number };
export type CanvasTransform = { scale: number; x: number; y: number };

export function canvasTransform(
  session: Pick<MaskSession, "width" | "height" | "zoom" | "panX" | "panY">,
  viewport: Viewport,
): CanvasTransform {
  const fit = Math.min(
    (Math.max(viewport.width, 25) - 24) / session.width,
    (Math.max(viewport.height, 25) - 24) / session.height,
    1,
  );
  const scale = fit * session.zoom;
  return {
    scale,
    x: (viewport.width - session.width * scale) / 2 + session.panX,
    y: (viewport.height - session.height * scale) / 2 + session.panY,
  };
}

/** Invert only the display transform; persisted coordinates remain native image pixels. */
export function nativePoint(point: MaskPoint, transform: CanvasTransform): MaskPoint {
  return {
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale,
  };
}

export function containMaskRect(source: Viewport, target: Viewport) {
  const scale = Math.min(target.width / source.width, target.height / source.height);
  const width = Math.max(1, Math.floor(source.width * scale));
  const height = Math.max(1, Math.floor(source.height * scale));
  return {
    x: Math.floor((target.width - width) / 2),
    y: Math.floor((target.height - height) / 2),
    width,
    height,
  };
}

/** Keep the image pixel under the zoom anchor in the same screen position. */
export function zoomAt(
  session: MaskSession,
  viewport: Viewport,
  anchor: MaskPoint,
  zoom: number,
): MaskSession {
  const nextZoom = Math.max(0.25, Math.min(8, zoom));
  const point = nativePoint(anchor, canvasTransform(session, viewport));
  const nextTransform = canvasTransform({ ...session, zoom: nextZoom, panX: 0, panY: 0 }, viewport);
  return {
    ...session,
    zoom: nextZoom,
    panX: anchor.x - nextTransform.x - point.x * nextTransform.scale,
    panY: anchor.y - nextTransform.y - point.y * nextTransform.scale,
  };
}

export function appendCommand(session: MaskSession, command: MaskCommand): MaskSession {
  return {
    ...session,
    commands: [...session.commands.slice(0, session.cursor), command],
    cursor: session.cursor + 1,
    revision: session.revision + 1,
  };
}

/** Append coalesced samples with one command-array copy and one edit revision. */
export function appendStrokePoints(
  session: MaskSession,
  commandIndex: number,
  points: readonly MaskPoint[],
): MaskSession {
  const command = session.commands[commandIndex];
  if (!command || command.kind === "clear" || commandIndex !== session.cursor - 1) return session;
  const added: MaskPoint[] = [];
  let last = command.points.at(-1);
  for (const point of points) {
    if (last?.x === point.x && last.y === point.y) continue;
    added.push(point);
    last = point;
  }
  if (!added.length) return session;
  return {
    ...session,
    commands: session.commands.map((item, index) =>
      index === commandIndex ? { ...command, points: [...command.points, ...added] } : item,
    ),
    revision: session.revision + 1,
  };
}

export function undoMask(session: MaskSession): MaskSession {
  return session.cursor === 0
    ? session
    : { ...session, cursor: session.cursor - 1, revision: session.revision + 1 };
}

export function redoMask(session: MaskSession): MaskSession {
  return session.cursor === session.commands.length
    ? session
    : { ...session, cursor: session.cursor + 1, revision: session.revision + 1 };
}

/** White pixels are selected; alpha is composited onto black, never used as the selection. */
export function binaryMaskPixels(pixels: Uint8ClampedArray): Uint8ClampedArray {
  const binary = new Uint8ClampedArray(pixels.length);
  for (let index = 0; index < pixels.length; index += 4) {
    const brightness =
      ((pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3) * (pixels[index + 3] / 255);
    const value = brightness >= 128 ? 255 : 0;
    binary[index] = binary[index + 1] = binary[index + 2] = value;
    binary[index + 3] = 255;
  }
  return binary;
}

export function overlayMaskPixels(mask: Uint8ClampedArray): Uint8ClampedArray {
  const overlay = new Uint8ClampedArray(mask.length);
  for (let index = 0; index < mask.length; index += 4) {
    overlay[index] = 70;
    overlay[index + 1] = 210;
    overlay[index + 2] = 190;
    overlay[index + 3] = mask[index] === 255 ? 125 : 0;
  }
  return overlay;
}

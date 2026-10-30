import type { MaskSession } from "@/bindings/workbench";
import { mediaApi } from "@/features/media/api";
import { imageUnavailableReason } from "@/features/media/model";
import { binaryMaskPixels, containMaskRect } from "./model";

export async function loadMaskBitmap(id: string): Promise<ImageBitmap> {
  const bytes = await mediaApi.content(id);
  return createImageBitmap(new Blob([bytes]));
}

/** Rebuild an opaque black/white mask independently of the displayed source and overlay. */
export function drawMask(
  session: Pick<MaskSession, "width" | "height" | "commands" | "cursor">,
  baseMask: ImageBitmap | null,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = session.width;
  canvas.height = session.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建遮罩画布，请重新打开编辑器。");
  context.fillStyle = "black";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  if (baseMask) {
    const fit = containMaskRect(baseMask, canvas);
    context.drawImage(baseMask, fit.x, fit.y, fit.width, fit.height);
  }
  for (const command of session.commands.slice(0, session.cursor)) {
    if (command.kind === "clear") {
      context.fillStyle = "black";
      context.fillRect(0, 0, canvas.width, canvas.height);
      continue;
    }
    const first = command.points[0];
    if (!first) continue;
    context.fillStyle = context.strokeStyle = command.kind === "paint" ? "white" : "black";
    context.lineWidth = command.size;
    context.lineCap = context.lineJoin = "round";
    context.beginPath();
    context.arc(first.x, first.y, command.size / 2, 0, Math.PI * 2);
    context.fill();
    if (command.points.length > 1) {
      context.beginPath();
      context.moveTo(first.x, first.y);
      for (const point of command.points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  }
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  pixels.data.set(binaryMaskPixels(pixels.data));
  context.putImageData(pixels, 0, 0);
  return canvas;
}

/** Export the retained source's native dimensions, never a screenshot or colored overlay. */
export async function renderMaskPng(session: MaskSession): Promise<Uint8Array> {
  const source = await mediaApi.asset(session.sourceAssetId);
  const unavailable = imageUnavailableReason(source);
  if (unavailable) throw new Error(unavailable);
  if (source.width !== session.width || source.height !== session.height)
    throw new Error("遮罩会话尺寸与底图原生尺寸不一致，请重新打开此底图的遮罩编辑器。");
  const base = session.baseMaskAssetId ? await loadMaskBitmap(session.baseMaskAssetId) : null;
  try {
    const canvas = drawMask(session, base);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("无法导出遮罩 PNG，请重试。"))),
        "image/png",
      );
    });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    base?.close();
  }
}

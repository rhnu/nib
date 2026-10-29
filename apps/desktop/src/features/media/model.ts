import type { MediaAsset } from "../../bindings/media";

export function imageName(asset: MediaAsset): string {
  if (asset.source.kind === "import" && asset.source.name) return asset.source.name;
  if (asset.source.kind === "job") return "生成图片";
  return asset.kind === "image" ? "图片材料" : asset.kind === "vibe" ? "Vibe 编码" : "Vibe 文档";
}

export function imageUnavailableReason(
  asset: Pick<MediaAsset, "kind" | "available">,
): string | null {
  if (asset.kind !== "image") return "此媒体不是图片，无法作为图像使用。";
  if (!asset.available) return "图片文件缺失或已损坏，请重新导入。";
  return null;
}

/** A source-image action has exactly one target; reject multi-file input as a whole. */
export function singleImageFile<T>(files: ArrayLike<T>): { file: T | null; error: string | null } {
  if (files.length === 0) return { file: null, error: null };
  if (files.length !== 1)
    return { file: null, error: "每次只能导入一张底图。请选择或拖入单张图片。" };
  return { file: files[0], error: null };
}

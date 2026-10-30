import { t, deferMessage, type DeferredMessage } from "@/shared/i18n";
import type { MediaAsset } from "@/bindings/media";

export function imageName(asset: MediaAsset): string {
  if (asset.source.kind === "import" && asset.source.name) return asset.source.name;
  if (asset.source.kind === "job") return t("media.generatedImage");
  return asset.kind === "image"
    ? t("media.imageMaterial")
    : asset.kind === "vibe"
      ? t("media.vibeEncoding")
      : t("media.vibeDocument");
}

export function imageUnavailableReason(
  asset: Pick<MediaAsset, "kind" | "available">,
): string | null {
  if (asset.kind !== "image") return t("media.mediaNotImage");
  if (!asset.available) return t("media.imageFileMissing");
  return null;
}

/** A source-image action has exactly one target; reject multi-file input as a whole. */
export function singleImageFile<T>(files: ArrayLike<T>): {
  file: T | null;
  error: DeferredMessage | null;
} {
  if (files.length === 0) return { file: null, error: null };
  if (files.length !== 1)
    return { file: null, error: deferMessage(() => t("media.singleSourceImageOnly")) };
  return { file: files[0], error: null };
}

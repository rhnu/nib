import type { MediaAsset } from "../../bindings/media";
import { Button, Notice } from "../../shared/ui";
import { useMediaContent } from "./useMediaContent";
import { imageUnavailableReason } from "./model";
import "./media.css";

/** Immutable original content is shared with other mounted viewers. */
export function useAssetImage(asset: MediaAsset) {
  const unavailable = imageUnavailableReason(asset);
  const image = useMediaContent(asset.id, asset.mimeType, !unavailable);
  return { ...image, error: unavailable ?? image.error };
}

export function AssetImage({
  asset,
  alt,
  className,
}: {
  asset: MediaAsset;
  alt: string;
  className?: string;
}) {
  const image = useAssetImage(asset);
  if (image.error)
    return (
      <Notice
        actions={
          asset.available && asset.kind === "image" ? (
            <Button onClick={image.retry}>重试读取</Button>
          ) : undefined
        }
      >
        {image.error}
      </Notice>
    );
  if (!image.url) return <output className="media-loading">正在读取图片…</output>;
  return (
    <img className={className ?? "media-image"} src={image.url} alt={alt} onError={image.failed} />
  );
}

import { t, useTranslation } from "@/shared/i18n";
import type { MediaAsset } from "@/bindings/media";
import { Button, Notice } from "@/shared/ui";
import { useMediaContent } from "./use-media-content";
import { imageUnavailableReason } from "./model";
import { ImageContextActions } from "./image-context-actions";
import "./media.css";
import { SafetyImage } from "./safety-image";

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
  safetyDisabled = false,
}: {
  asset: MediaAsset;
  alt: string;
  className?: string;
  safetyDisabled?: boolean;
}) {
  useTranslation();

  const image = useAssetImage(asset);
  if (image.error)
    return (
      <Notice
        actions={
          asset.available && asset.kind === "image" ? (
            <Button onClick={image.retry}>{t("media.retryRead")}</Button>
          ) : undefined
        }
      >
        {image.error}
      </Notice>
    );
  if (!image.url) return <output className="media-loading">{t("media.loadingImage")}</output>;
  return (
    <ImageContextActions
      id={asset.id}
      mimeType={asset.mimeType}
      available={asset.available}
      deferToAncestor
    >
      <SafetyImage
        assetId={asset.id}
        safetyDisabled={safetyDisabled}
        className={className ?? "media-image"}
        src={image.url}
        alt={alt}
        onError={image.failed}
      />
    </ImageContextActions>
  );
}

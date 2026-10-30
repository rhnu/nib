import { t, useTranslation } from "@/shared/i18n";
import { Button } from "@/shared/ui";
import { AssetImage } from "@/features/media/asset-image";
import { useMediaAsset } from "@/features/media/use-media-asset";

export function SourceImageView({ id }: { id: string }) {
  useTranslation();

  const media = useMediaAsset(id);
  return (
    <div className="generation-source-view">
      {media.error ? (
        <div role="alert">
          {media.error}
          <Button onClick={media.retry}>{t("generation.retryLoad")}</Button>
        </div>
      ) : media.asset ? (
        <>
          <div className="generation-canvas-metadata generation-muted">
            {t("generation.sourceImagePrefix")}
            {media.asset.width} × {media.asset.height}
          </div>
          <AssetImage
            asset={media.asset}
            alt={t("generation.operationSource")}
            className="generation-source-image"
          />
        </>
      ) : (
        <output>{t("generation.loadingSource")}</output>
      )}
    </div>
  );
}

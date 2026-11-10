import { Button, Col } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";

import { AssetImage } from "@/features/media/asset-image";
import { useMediaAsset } from "@/features/media/use-media-asset";

export function SourceImageView({ id }: { id: string }) {
  useTranslation();

  const media = useMediaAsset(id);
  return (
    <Col
      gap={0}
      align="stretch"
      className="generation-source-view flex flex-1 min-w-0 min-h-0 flex-col gap-[10px] overflow-auto p-space-4"
    >
      {media.error ? (
        <div role="alert">
          {media.error}
          <Button onClick={media.retry}>{t("generation.retryLoad")}</Button>
        </div>
      ) : media.asset ? (
        <>
          <div className="generation-canvas-metadata overflow-hidden whitespace-nowrap text-ellipsis generation-muted text-muted">
            {t("generation.sourceImagePrefix")}
            {media.asset.width} × {media.asset.height}
          </div>
          <AssetImage
            asset={media.asset}
            alt={t("generation.operationSource")}
            className="generation-source-image block w-full min-h-0 flex-1 object-contain"
          />
        </>
      ) : (
        <output>{t("generation.loadingSource")}</output>
      )}
    </Col>
  );
}

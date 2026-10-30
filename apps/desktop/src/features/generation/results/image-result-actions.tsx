import { t, useTranslation } from "@/shared/i18n";
import { useState } from "react";
import { Clapperboard, ImagePlus, Paintbrush, ScanLine, Sparkles, Maximize } from "lucide-react";
import type { Draft } from "@/bindings/workbench";
import type { ImageOperationAction } from "@/features/inputs/image-operation";
import { Button, IconButton, Modal, Notice } from "@/shared/ui";
import { ImageMetadataDialog } from "@/features/media/image-metadata-dialog";
import { useMediaAsset } from "@/features/media/use-media-asset";
import { useMediaTools } from "@/features/media/media-tools-context";

/** Overlay tools operate on the original asset; visible labels stay in tooltips. */
export function ImageResultActions({
  assetId,
  available,
  onImageOperation,
  onRestore,
  canMaxEnhance,
  canInpaint,
  showDirector = true,
}: {
  assetId: string;
  available: boolean;
  onImageOperation: (id: string, kind: ImageOperationAction) => void;
  onRestore: (draft: Draft) => void;
  canMaxEnhance: boolean;
  canInpaint: boolean;
  showDirector?: boolean;
}) {
  useTranslation();

  const tools = useMediaTools();
  const [metadataOpen, setMetadataOpen] = useState(false);
  const media = useMediaAsset(metadataOpen ? assetId : null);
  return (
    <>
      <div className="generation-image-actions" aria-label={t("generation.continueFromImage")}>
        <IconButton
          label={t("generation.useAsSource")}
          disabled={!available}
          onClick={() => onImageOperation(assetId, "imageToImage")}
        >
          <ImagePlus size={17} />
        </IconButton>
        <IconButton
          label={t("generation.inpainting")}
          disabled={!available || !canInpaint}
          onClick={() => onImageOperation(assetId, "inpainting")}
        >
          <Paintbrush size={17} />
        </IconButton>
        <IconButton
          label={t("generation.maxEnhance")}
          disabled={!available || !canMaxEnhance}
          onClick={() => onImageOperation(assetId, "maxEnhance")}
        >
          <Sparkles size={17} />
        </IconButton>
        <IconButton
          label={t("generation.upscaleImage")}
          disabled={!available}
          onClick={() => onImageOperation(assetId, "upscale")}
        >
          <Maximize size={17} />
        </IconButton>
        {tools && showDirector && (
          <IconButton
            label={t("generation.sendToDirector")}
            disabled={!available}
            onClick={() => tools.onDirector(assetId)}
          >
            <Clapperboard size={17} />
          </IconButton>
        )}
        <IconButton
          label={t("generation.imageInfoRestore")}
          disabled={!available}
          onClick={() => setMetadataOpen(true)}
        >
          <ScanLine size={17} />
        </IconButton>
      </div>
      {metadataOpen && !media.asset && (
        <Modal open title={t("generation.imageInfo")} onClose={() => setMetadataOpen(false)}>
          {media.error ? (
            <Notice actions={<Button onClick={media.retry}>{t("generation.retryLoad")}</Button>}>
              {media.error}
            </Notice>
          ) : (
            <output>{t("generation.loadingImageInfo")}</output>
          )}
        </Modal>
      )}
      {metadataOpen && media.asset && (
        <ImageMetadataDialog
          asset={media.asset}
          onClose={() => setMetadataOpen(false)}
          onRestore={onRestore}
        />
      )}
    </>
  );
}

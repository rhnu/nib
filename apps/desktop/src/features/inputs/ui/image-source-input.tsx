import { t, useTranslation } from "@/shared/i18n";
import { Popover } from "@base-ui/react/popover";
import { Info, Paintbrush, Replace, Settings2, X } from "lucide-react";
import type { CreationOperation, ModelCapabilities } from "@/bindings/workbench";
import type { MediaAsset } from "@/bindings/media";
import { Button, IconButton } from "@/shared/ui";
import { AssetImage } from "@/features/media/asset-image";
import type { useMediaAsset } from "@/features/media/use-media-asset";
import type { ImageOperationFeedback } from "./image-operation-feedback";

type MediaState = ReturnType<typeof useMediaAsset>;

/** Source image details and the compact overlay share the panel's operation popover. */
export function ImageSourceInput({
  media,
  sourceId,
  operationKind,
  capabilities,
  onMetadata,
  onEditMask,
  onReplace,
}: {
  media: MediaState;
  sourceId: string;
  operationKind: CreationOperation["kind"];
  capabilities: ModelCapabilities | null;
  onMetadata: (asset: MediaAsset) => void;
  onEditMask: (assetId: string) => void;
  onReplace: () => void;
}) {
  useTranslation();

  return (
    <div className="image-source" data-setting-field="sourceImage">
      {media.loading && <output className="muted">{t("inputs.loadingSource")}</output>}
      {media.error && (
        <div className="inline-warning" role="alert">
          {media.error}
          <Button className="quiet" onClick={media.retry}>
            {t("inputs.retry")}
          </Button>
        </div>
      )}
      {media.asset && (
        <>
          <div className="media-input-preview">
            <Popover.Root>
              <Popover.Trigger
                className="image-source-preview"
                aria-label={t("inputs.viewInputDetails")}
              >
                <AssetImage
                  asset={media.asset}
                  alt={t("inputs.operationSource")}
                  className="image-source-thumbnail"
                />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner side="right" sideOffset={8} className="image-input-positioner">
                  <Popover.Popup className="image-input-popup">
                    <header>
                      <Popover.Title>
                        {media.asset.source.kind === "import"
                          ? (media.asset.source.name ?? t("inputs.savedImage"))
                          : t("inputs.savedImage")}
                      </Popover.Title>
                      <Popover.Close
                        className="icon-button"
                        aria-label={t("inputs.closeInputDetails")}
                      >
                        <X size={14} />
                      </Popover.Close>
                    </header>
                    <AssetImage
                      asset={media.asset}
                      alt={t("inputs.inputPreview")}
                      className="image-source-detail"
                    />
                    <p>
                      {media.asset.width ?? "?"} × {media.asset.height ?? "?"} ·{" "}
                      {media.asset.mimeType}
                    </p>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            <fieldset className="media-input-tools" aria-label={t("inputs.inputActions")}>
              <IconButton
                label={t("inputs.imageInfoRestore")}
                onClick={() => onMetadata(media.asset!)}
              >
                <Info size={14} />
              </IconButton>
              {capabilities?.inpainting !== false && (
                <IconButton
                  label={
                    operationKind === "inpainting" ? t("inputs.editMask") : t("inputs.drawMask")
                  }
                  disabled={!media.asset.available}
                  onClick={() => onEditMask(sourceId!)}
                >
                  <Paintbrush size={14} />
                </IconButton>
              )}
              <IconButton label={t("inputs.replaceInput")} onClick={onReplace}>
                <Replace size={14} />
              </IconButton>
              {(operationKind === "imageToImage" || operationKind === "inpainting") && (
                <Popover.Trigger
                  className="icon-button"
                  title={t("inputs.advancedInput")}
                  aria-label={t("inputs.advancedInput")}
                >
                  <Settings2 size={14} />
                </Popover.Trigger>
              )}
            </fieldset>
          </div>
          {!media.asset.available && (
            <p className="inline-warning">{t("inputs.sourceUnavailable")}</p>
          )}
        </>
      )}
    </div>
  );
}

/** Applied masks use saved media; unfinished editor strokes are displayed separately. */
export function AppliedMaskInput({
  mask,
  feedback,
}: {
  mask: MediaState;
  feedback: ImageOperationFeedback;
}) {
  useTranslation();

  const { messages } = feedback;
  return (
    <div className="image-source" data-setting-field="maskAssetId">
      {mask.loading && <output className="muted">{t("inputs.loadingAppliedMask")}</output>}
      {mask.error && (
        <div className="inline-warning" role="alert">
          {mask.error}
          <Button className="quiet" onClick={mask.retry}>
            {t("inputs.retry")}
          </Button>
        </div>
      )}
      {mask.asset && (
        <>
          <AssetImage
            asset={mask.asset}
            alt={t("inputs.appliedInpaintMask")}
            className="image-source-thumbnail"
          />
          <div className="image-source-info">
            <strong>{t("inputs.appliedMask")}</strong>
            <small>
              {mask.asset.width ?? "?"} × {mask.asset.height ?? "?"}
            </small>
            {!mask.asset.available && (
              <p className="inline-warning">{t("inputs.maskUnavailable")}</p>
            )}
          </div>
        </>
      )}
      {messages("maskAssetId")}
      {messages("mask")}
    </div>
  );
}

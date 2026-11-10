import { Button, IconButton, Row, Grid } from "@/shared/ui";

import { MediaInputPreview, MediaInputTools } from "@/features/media/media-input-layout";

import { t, useTranslation } from "@/shared/i18n";
import { Popover } from "@base-ui/react/popover";
import { Info, Paintbrush, Replace, Settings2, X } from "lucide-react";
import type { CreationOperation, ModelCapabilities } from "@/bindings/workbench";
import type { MediaAsset } from "@/bindings/media";

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
    <Row
      gap={0}
      className="image-source flex gap-[9px] items-start min-w-0"
      data-setting-field="sourceImage"
    >
      {media.loading && <output className="muted text-muted">{t("inputs.loadingSource")}</output>}
      {media.error && (
        <div className="inline-warning text-danger text-label leading-[1.7]" role="alert">
          {media.error}
          <Button variant="quiet" className="" onClick={media.retry}>
            {t("inputs.retry")}
          </Button>
        </div>
      )}
      {media.asset && (
        <>
          <MediaInputPreview>
            <Popover.Root>
              <Popover.Trigger
                render={<Button />}
                className="image-source-preview inline-flex p-0 [border:0] bg-transparent rounded-control cursor-pointer"
                aria-label={t("inputs.viewInputDetails")}
              >
                <AssetImage
                  asset={media.asset}
                  alt={t("inputs.operationSource")}
                  className="image-source-thumbnail [flex:0_0_72px] w-[72px] h-[72px] object-contain bg-background [border:1px_solid_var(--line)] rounded-control"
                />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner
                  side="right"
                  sideOffset={8}
                  className="image-input-positioner z-60 max-w-[calc(100vw_-_24px)]"
                >
                  <Popover.Popup className="image-input-popup [&_>_header]:flex [&_>_header]:items-center [&_>_header]:justify-between [&_>_header]:gap-space-3 [&_>_header]:mb-space-4 [&_>_header]:text-label [&_>_header]:font-semibold [&_>_header_h2]:[font-size:inherit] [&_>_header_h2]:m-0 [&_>_header_h2]:wrap-anywhere [&_>_p]:text-caption [&_>_p]:text-muted w-[290px] max-w-[calc(100vw_-_24px)] max-h-[min(620px,_var(--available-height))] overflow-auto p-space-4 [border:1px_solid_var(--line)] rounded-control bg-panel shadow-overlay">
                    <header>
                      <Popover.Title>
                        {media.asset.source.kind === "import"
                          ? (media.asset.source.name ?? t("inputs.savedImage"))
                          : t("inputs.savedImage")}
                      </Popover.Title>
                      <Popover.Close
                        render={<IconButton label={t("inputs.closeInputDetails")} />}
                        className="icon-button"
                        aria-label={t("inputs.closeInputDetails")}
                      >
                        <X size={14} />
                      </Popover.Close>
                    </header>
                    <AssetImage
                      asset={media.asset}
                      alt={t("inputs.inputPreview")}
                      className="image-source-detail max-w-full max-h-[300px] object-contain m-auto"
                    />
                    <p>
                      {media.asset.width ?? "?"} × {media.asset.height ?? "?"} ·{" "}
                      {media.asset.mimeType}
                    </p>
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            <MediaInputTools aria-label={t("inputs.inputActions")}>
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
                  render={<IconButton label={t("inputs.advancedInput")} />}
                  className="icon-button"
                  title={t("inputs.advancedInput")}
                  aria-label={t("inputs.advancedInput")}
                >
                  <Settings2 size={14} />
                </Popover.Trigger>
              )}
            </MediaInputTools>
          </MediaInputPreview>
          {!media.asset.available && (
            <p className="inline-warning text-danger text-label leading-[1.7]">
              {t("inputs.sourceUnavailable")}
            </p>
          )}
        </>
      )}
    </Row>
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
    <Row
      gap={0}
      className="image-source flex gap-[9px] items-start min-w-0"
      data-setting-field="maskAssetId"
    >
      {mask.loading && (
        <output className="muted text-muted">{t("inputs.loadingAppliedMask")}</output>
      )}
      {mask.error && (
        <div className="inline-warning text-danger text-label leading-[1.7]" role="alert">
          {mask.error}
          <Button variant="quiet" className="" onClick={mask.retry}>
            {t("inputs.retry")}
          </Button>
        </div>
      )}
      {mask.asset && (
        <>
          <AssetImage
            asset={mask.asset}
            alt={t("inputs.appliedInpaintMask")}
            className="image-source-thumbnail [flex:0_0_72px] w-[72px] h-[72px] object-contain bg-background [border:1px_solid_var(--line)] rounded-control"
          />
          <Grid
            align="stretch"
            gap={0}
            columns={1}
            minColumnWidth="0px"
            className="image-source-info [&_strong]:font-medium [&_small]:text-muted [&_small]:text-caption [&_small]:leading-[1.6] [&_.ui-button]:[justify-self:start] [&_.ui-button]:text-caption grid gap-space-1 min-w-0 wrap-anywhere text-caption"
          >
            <strong>{t("inputs.appliedMask")}</strong>
            <small>
              {mask.asset.width ?? "?"} × {mask.asset.height ?? "?"}
            </small>
            {!mask.asset.available && (
              <p className="inline-warning text-danger text-label leading-[1.7]">
                {t("inputs.maskUnavailable")}
              </p>
            )}
          </Grid>
        </>
      )}
      {messages("maskAssetId")}
      {messages("mask")}
    </Row>
  );
}

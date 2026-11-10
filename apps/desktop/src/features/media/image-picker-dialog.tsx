import { Row, ButtonGroup, Grid, Input, Button, Modal, Notice } from "@/shared/ui";

import { t, useTranslation, formatNumber } from "@/shared/i18n";
import { useState } from "react";
import type { MediaAsset } from "@/bindings/media";
import type { Draft } from "@/bindings/workbench";

import { AssetImage } from "./asset-image";
import { ImageImporter } from "./image-importer";
import { ImageMetadataDialog } from "./image-metadata-dialog";
import { mediaApi } from "./api";
import { imageName, imageUnavailableReason } from "./model";
import { useMediaQuery } from "./use-media-query";

async function listImages() {
  const assets = await mediaApi.assets();
  return assets.filter((asset) => asset.kind === "image");
}

type PickerProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  onSelect: (asset: MediaAsset) => void;
  onRestore?: (draft: Draft) => void;
};

function PickerContent({
  onClose,
  onSelect,
  onRestore,
  title = t("media.chooseSourceImage"),
}: Omit<PickerProps, "open">) {
  useTranslation();

  const assets = useMediaQuery(["media", "images"], "images", listImages, 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imported, setImported] = useState<MediaAsset | null>(null);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const images =
    imported && !assets.value?.some((asset) => asset.id === imported.id)
      ? [imported, ...(assets.value ?? [])]
      : (assets.value ?? []);
  const selected = images.find((asset) => asset.id === selectedId) ?? null;
  return (
    <Modal open onClose={onClose} title={title} wide>
      <Grid
        columns={1}
        align="stretch"
        gap={0}
        minColumnWidth="0px"
        className="media-picker max-[680px]:grid-cols-[minmax(0,_1fr)] grid grid-cols-[minmax(260px,_1fr)_minmax(0,_1.15fr)] flex-1 min-h-0 overflow-auto"
      >
        <div className="media-picker-library max-[680px]:overflow-visible p-[14px] min-w-0 overflow-auto">
          <ImageImporter
            onImported={(asset) => {
              setImported(asset);
              setSelectedId(asset.id);
              assets.retry();
            }}
          />
          <Row
            as="header"
            gap={0}
            className="ui-heading flex items-center justify-between gap-space-3 min-w-0 min-h-control [&_>_:is(h2,_h3)]:m-0 [&_>_:is(h2,_h3)]:min-w-0 [&_>_:is(h2,_h3)]:text-section [&_>_:is(h2,_h3)]:font-semibold media-library-heading m-[var(--space-5)_0_var(--space-2)]"
          >
            <h3>{t("media.existingImages")}</h3>
            <Button variant="quiet" className="" disabled={assets.loading} onClick={assets.retry}>
              {t("media.refresh")}
            </Button>
          </Row>
          {assets.loading && <output>{t("media.loadingImageList")}</output>}
          {assets.error && (
            <Notice actions={<Button onClick={assets.retry}>{t("media.retryLoad")}</Button>}>
              {assets.error}
            </Notice>
          )}
          {!assets.loading && !assets.error && images.length === 0 && (
            <p className="muted text-muted">{t("media.noImages")}</p>
          )}
          <Grid
            align="stretch"
            as="fieldset"
            gap={0}
            columns={1}
            minColumnWidth="0px"
            className="media-image-list grid gap-space-1"
          >
            <legend className="media-sr-only absolute w-[1px] h-[1px] p-0 overflow-hidden [clip-path:inset(50%)] whitespace-nowrap">
              {t("media.chooseExistingImage")}
            </legend>
            {images.map((asset) => (
              <Row
                as="label"
                gap={0}
                key={asset.id}
                aria-label={t("media.selectNamedImage", { value0: imageName(asset) })}
                className={`media-image-row [&.is-selected]:border-accent [&.is-selected]:bg-accent-soft [&_>_input[type='radio']]:w-[15px] [&_>_input[type='radio']]:h-[15px] [&_>_input[type='radio']]:shrink-0 [&_>_input[type='radio']]:m-0 [&_>_span]:grid [&_>_span]:min-w-0 [&_small]:text-muted flex items-center gap-space-3 p-space-3 [border:1px_solid_var(--line-subtle)] rounded-control cursor-pointer min-w-0 ${selectedId === asset.id ? "is-selected" : ""}`}
              >
                <Input
                  type="radio"
                  name={t("media.sourceImage")}
                  checked={selectedId === asset.id}
                  onChange={() => {
                    setSelectedId(asset.id);
                    setMetadataOpen(false);
                  }}
                />
                <span>
                  <span className="media-image-name wrap-anywhere">{imageName(asset)}</span>
                  <small>
                    {asset.width ?? "?"} × {asset.height ?? "?"} · {asset.mimeType}
                    {!asset.available && t("media.fileUnavailableSuffix")}
                  </small>
                </span>
              </Row>
            ))}
          </Grid>
        </div>
        <div className="media-picker-preview [&_.media-asset-heading]:mt-space-4 max-[680px]:overflow-visible max-[680px]:[border-left:0] max-[680px]:[border-top:1px_solid_var(--line-subtle)] p-[14px] min-w-0 overflow-auto [border-left:1px_solid_var(--line-subtle)]">
          {selected ? (
            <>
              <AssetImage
                key={selected.id}
                asset={selected}
                alt={t("media.imageToSelect", { value0: imageName(selected) })}
              />
              <p className="media-asset-heading wrap-anywhere">{imageName(selected)}</p>
              <p className="muted text-muted">
                {selected.width ?? t("media.unknownWidth")} ×{" "}
                {selected.height ?? t("media.unknownHeight")} ·{" "}
                {t("media.byteCount", {
                  count: selected.byteLength,
                  value: formatNumber(selected.byteLength),
                })}
              </p>
              <Button
                disabled={!!imageUnavailableReason(selected)}
                onClick={() => setMetadataOpen(true)}
              >
                {t("media.imageMetadata")}
              </Button>
            </>
          ) : (
            <p className="muted text-muted">{t("media.noImageSelected")}</p>
          )}
        </div>
      </Grid>
      <footer className="media-picker-footer [&_p]:text-caption [&_p]:mb-space-3 p-[10px_14px] [border-top:1px_solid_var(--line-subtle)]">
        <ButtonGroup
          gap={0}
          className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
        >
          <Button onClick={onClose}>{t("media.cancel")}</Button>
          <Button
            variant="primary"
            className=""
            disabled={!selected || !!imageUnavailableReason(selected)}
            onClick={() => {
              if (!selected || imageUnavailableReason(selected)) return;
              onSelect(selected);
              onClose();
            }}
          >
            {t("media.selectImage")}
          </Button>
        </ButtonGroup>
      </footer>
      {metadataOpen && selected && (
        <ImageMetadataDialog
          asset={selected}
          onClose={() => setMetadataOpen(false)}
          onOpenTool={onClose}
          onRestore={
            onRestore
              ? (draft) => {
                  onRestore(draft);
                  onClose();
                }
              : undefined
          }
        />
      )}
    </Modal>
  );
}

export function ImagePickerDialog({ open, ...props }: PickerProps) {
  useTranslation();

  return open ? <PickerContent {...props} /> : null;
}

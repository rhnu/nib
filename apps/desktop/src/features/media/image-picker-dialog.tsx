import { t, useTranslation, formatNumber } from "@/shared/i18n";
import { useState } from "react";
import type { MediaAsset } from "@/bindings/media";
import type { Draft } from "@/bindings/workbench";
import { Button, Modal, Notice } from "@/shared/ui";
import { AssetImage } from "./asset-image";
import { ImageImporter } from "./image-importer";
import { ImageMetadataDialog } from "./image-metadata-dialog";
import { mediaApi } from "./api";
import { imageName, imageUnavailableReason } from "./model";
import { useMediaQuery } from "./use-media-query";
import "./media.css";

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
      <div className="media-picker">
        <div className="media-picker-library">
          <ImageImporter
            onImported={(asset) => {
              setImported(asset);
              setSelectedId(asset.id);
              assets.retry();
            }}
          />
          <header className="media-library-heading">
            <h3>{t("media.existingImages")}</h3>
            <Button className="quiet" disabled={assets.loading} onClick={assets.retry}>
              {t("media.refresh")}
            </Button>
          </header>
          {assets.loading && <output>{t("media.loadingImageList")}</output>}
          {assets.error && (
            <Notice actions={<Button onClick={assets.retry}>{t("media.retryLoad")}</Button>}>
              {assets.error}
            </Notice>
          )}
          {!assets.loading && !assets.error && images.length === 0 && (
            <p className="muted">{t("media.noImages")}</p>
          )}
          <fieldset className="media-image-list">
            <legend className="media-sr-only">{t("media.chooseExistingImage")}</legend>
            {images.map((asset) => (
              <label
                key={asset.id}
                aria-label={t("media.selectNamedImage", { value0: imageName(asset) })}
                className={`media-image-row ${selectedId === asset.id ? "is-selected" : ""}`}
              >
                <input
                  type="radio"
                  name={t("media.sourceImage")}
                  checked={selectedId === asset.id}
                  onChange={() => {
                    setSelectedId(asset.id);
                    setMetadataOpen(false);
                  }}
                />
                <span>
                  <span className="media-image-name">{imageName(asset)}</span>
                  <small>
                    {asset.width ?? "?"} × {asset.height ?? "?"} · {asset.mimeType}
                    {!asset.available && t("media.fileUnavailableSuffix")}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        <div className="media-picker-preview">
          {selected ? (
            <>
              <AssetImage
                key={selected.id}
                asset={selected}
                alt={t("media.imageToSelect", { value0: imageName(selected) })}
              />
              <p className="media-asset-heading">{imageName(selected)}</p>
              <p className="muted">
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
            <p className="muted">{t("media.noImageSelected")}</p>
          )}
        </div>
      </div>
      <footer className="media-picker-footer">
        <div className="media-dialog-actions">
          <Button onClick={onClose}>{t("media.cancel")}</Button>
          <Button
            className="primary"
            disabled={!selected || !!imageUnavailableReason(selected)}
            onClick={() => {
              if (!selected || imageUnavailableReason(selected)) return;
              onSelect(selected);
              onClose();
            }}
          >
            {t("media.selectImage")}
          </Button>
        </div>
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

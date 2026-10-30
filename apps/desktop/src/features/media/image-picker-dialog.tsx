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
  title = "选择底图",
}: Omit<PickerProps, "open">) {
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
            <h3>已有图片</h3>
            <Button className="quiet" disabled={assets.loading} onClick={assets.retry}>
              刷新
            </Button>
          </header>
          {assets.loading && <output>正在读取图片列表…</output>}
          {assets.error && (
            <Notice actions={<Button onClick={assets.retry}>重试加载</Button>}>
              {assets.error}
            </Notice>
          )}
          {!assets.loading && !assets.error && images.length === 0 && (
            <p className="muted">尚无图片</p>
          )}
          <fieldset className="media-image-list">
            <legend className="media-sr-only">选择一张已有图片</legend>
            {images.map((asset) => (
              <label
                key={asset.id}
                aria-label={`选择图片 ${imageName(asset)}`}
                className={`media-image-row ${selectedId === asset.id ? "is-selected" : ""}`}
              >
                <input
                  type="radio"
                  name="source-image"
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
                    {!asset.available && " · 文件不可用"}
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
                alt={`待选图片：${imageName(selected)}`}
              />
              <p className="media-asset-heading">{imageName(selected)}</p>
              <p className="muted">
                {selected.width ?? "未知宽度"} × {selected.height ?? "未知高度"} ·{" "}
                {selected.byteLength.toLocaleString()} 字节
              </p>
              <Button
                disabled={!!imageUnavailableReason(selected)}
                onClick={() => setMetadataOpen(true)}
              >
                图片元信息
              </Button>
            </>
          ) : (
            <p className="muted">未选择图片</p>
          )}
        </div>
      </div>
      <footer className="media-picker-footer">
        <div className="media-dialog-actions">
          <Button onClick={onClose}>取消</Button>
          <Button
            className="primary"
            disabled={!selected || !!imageUnavailableReason(selected)}
            onClick={() => {
              if (!selected || imageUnavailableReason(selected)) return;
              onSelect(selected);
              onClose();
            }}
          >
            选择图片
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
  return open ? <PickerContent {...props} /> : null;
}

import { useState } from "react";
import { Clapperboard, ImagePlus, Paintbrush, ScanLine, Sparkles, Maximize } from "lucide-react";
import type { Draft } from "../../../bindings/workbench";
import type { ImageOperationAction } from "../../inputs/image-operation";
import { Button, IconButton, Modal, Notice } from "../../../shared/ui";
import { ImageMetadataDialog } from "../../media/ImageMetadataDialog";
import { useMediaAsset } from "../../media/useMediaAsset";
import { useMediaTools } from "../../media/MediaToolsContext";

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
  const tools = useMediaTools();
  const [metadataOpen, setMetadataOpen] = useState(false);
  const media = useMediaAsset(metadataOpen ? assetId : null);
  return (
    <>
      <div className="generation-image-actions" aria-label="基于图片继续创作">
        <IconButton
          label="用作底图"
          disabled={!available}
          onClick={() => onImageOperation(assetId, "imageToImage")}
        >
          <ImagePlus size={17} />
        </IconButton>
        <IconButton
          label="局部重绘"
          disabled={!available || !canInpaint}
          onClick={() => onImageOperation(assetId, "inpainting")}
        >
          <Paintbrush size={17} />
        </IconButton>
        <IconButton
          label="Max Enhance"
          disabled={!available || !canMaxEnhance}
          onClick={() => onImageOperation(assetId, "maxEnhance")}
        >
          <Sparkles size={17} />
        </IconButton>
        <IconButton
          label="放大图片"
          disabled={!available}
          onClick={() => onImageOperation(assetId, "upscale")}
        >
          <Maximize size={17} />
        </IconButton>
        {tools && showDirector && (
          <IconButton
            label="发送到导演工具"
            disabled={!available}
            onClick={() => tools.onDirector(assetId)}
          >
            <Clapperboard size={17} />
          </IconButton>
        )}
        <IconButton
          label="图片信息与恢复"
          disabled={!available}
          onClick={() => setMetadataOpen(true)}
        >
          <ScanLine size={17} />
        </IconButton>
      </div>
      {metadataOpen && !media.asset && (
        <Modal open title="图片信息" onClose={() => setMetadataOpen(false)}>
          {media.error ? (
            <Notice actions={<Button onClick={media.retry}>重试读取</Button>}>{media.error}</Notice>
          ) : (
            <output>正在读取图片信息…</output>
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

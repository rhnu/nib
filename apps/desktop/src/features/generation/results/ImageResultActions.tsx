import { useState } from "react";
import type { Draft } from "../../../bindings/workbench";
import type { ImageOperationAction } from "../../inputs/image-operation";
import { Button } from "../../../shared/ui";
import { ImageMetadataDialog } from "../../media/ImageMetadataDialog";
import { useMediaAsset } from "../../media/useMediaAsset";
import { useMediaTools } from "../../media/MediaToolsContext";

/** Result tools use the original immutable asset, never a canvas screenshot. */
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
        <Button
          className="quiet"
          disabled={!available}
          onClick={() => onImageOperation(assetId, "imageToImage")}
        >
          用作底图
        </Button>
        <Button
          className="quiet"
          disabled={!available || !canInpaint}
          onClick={() => onImageOperation(assetId, "inpainting")}
        >
          局部重绘
        </Button>
        <Button
          className="quiet"
          disabled={!available || !canMaxEnhance}
          onClick={() => onImageOperation(assetId, "maxEnhance")}
        >
          Max Enhance
        </Button>
        <Button
          className="quiet"
          disabled={!available}
          onClick={() => onImageOperation(assetId, "upscale")}
        >
          放大
        </Button>
        <Button className="quiet" disabled={!available} onClick={() => setMetadataOpen(true)}>
          图片元信息
        </Button>
        {tools && showDirector && (
          <Button className="quiet" disabled={!available} onClick={() => tools.onDirector(assetId)}>
            导演工具
          </Button>
        )}
      </div>
      {metadataOpen && !media.asset && (
        <div className="generation-muted">
          {media.error ? (
            <>
              <span role="alert">{media.error}</span>
              <Button onClick={media.retry}>重试读取</Button>
            </>
          ) : (
            <output>正在读取图片信息…</output>
          )}
          <Button className="quiet" onClick={() => setMetadataOpen(false)}>
            关闭
          </Button>
        </div>
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

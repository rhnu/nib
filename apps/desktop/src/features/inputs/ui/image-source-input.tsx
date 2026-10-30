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
  return (
    <div className="image-source" data-setting-field="sourceImage">
      {media.loading && <output className="muted">正在读取底图…</output>}
      {media.error && (
        <div className="inline-warning" role="alert">
          {media.error}
          <Button className="quiet" onClick={media.retry}>
            重试
          </Button>
        </div>
      )}
      {media.asset && (
        <>
          <div className="media-input-preview">
            <Popover.Root>
              <Popover.Trigger className="image-source-preview" aria-label="查看输入图片名称与尺寸">
                <AssetImage
                  asset={media.asset}
                  alt="当前操作的底图"
                  className="image-source-thumbnail"
                />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner side="right" sideOffset={8} className="image-input-positioner">
                  <Popover.Popup className="image-input-popup">
                    <header>
                      <Popover.Title>
                        {media.asset.source.kind === "import"
                          ? (media.asset.source.name ?? "已保存图像")
                          : "已保存图像"}
                      </Popover.Title>
                      <Popover.Close className="icon-button" aria-label="关闭输入图片详情">
                        <X size={14} />
                      </Popover.Close>
                    </header>
                    <AssetImage
                      asset={media.asset}
                      alt="输入图片预览"
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
            <fieldset className="media-input-tools" aria-label="输入图片操作">
              <IconButton label="图像信息与恢复" onClick={() => onMetadata(media.asset!)}>
                <Info size={14} />
              </IconButton>
              {capabilities?.inpainting !== false && (
                <IconButton
                  label={operationKind === "inpainting" ? "编辑遮罩" : "绘制遮罩"}
                  disabled={!media.asset.available}
                  onClick={() => onEditMask(sourceId!)}
                >
                  <Paintbrush size={14} />
                </IconButton>
              )}
              <IconButton label="替换输入图片" onClick={onReplace}>
                <Replace size={14} />
              </IconButton>
              {(operationKind === "imageToImage" || operationKind === "inpainting") && (
                <Popover.Trigger
                  className="icon-button"
                  title="图像输入高级设置"
                  aria-label="图像输入高级设置"
                >
                  <Settings2 size={14} />
                </Popover.Trigger>
              )}
            </fieldset>
          </div>
          {!media.asset.available && <p className="inline-warning">底图不可用，请换图后再提交。</p>}
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
  const { messages } = feedback;
  return (
    <div className="image-source" data-setting-field="maskAssetId">
      {mask.loading && <output className="muted">正在读取已应用遮罩…</output>}
      {mask.error && (
        <div className="inline-warning" role="alert">
          {mask.error}
          <Button className="quiet" onClick={mask.retry}>
            重试
          </Button>
        </div>
      )}
      {mask.asset && (
        <>
          <AssetImage
            asset={mask.asset}
            alt="已应用的局部重绘遮罩"
            className="image-source-thumbnail"
          />
          <div className="image-source-info">
            <strong>已应用遮罩</strong>
            <small>
              {mask.asset.width ?? "?"} × {mask.asset.height ?? "?"}
            </small>
            {!mask.asset.available && (
              <p className="inline-warning">遮罩不可用，请重新编辑并应用。</p>
            )}
          </div>
        </>
      )}
      {messages("maskAssetId")}
      {messages("mask")}
    </div>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import { Copy, Download, Focus, ImageOff, Info, Minus, Plus, ArrowDownToLine } from "lucide-react";
import type { Draft } from "@/bindings/workbench";
import type { ResultSummary } from "@/bindings/generation";
import { Button, IconButton } from "@/shared/ui";
import { useMediaContent } from "@/features/media/use-media-content";
import { resultFilename } from "./result-file";
import { ImageResultActions } from "./image-result-actions";
import type { ImageOperationAction } from "@/features/inputs/image-operation";

export function ResultTile({
  result,
  selected,
  onSelect,
}: {
  result: ResultSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const image = useMediaContent(result.assetId, result.mimeType, result.available, "thumbnail");
  return (
    <Button
      className={"generation-result-open" + (selected ? " selected" : "")}
      aria-pressed={selected}
      aria-label={result.seed === null ? "查看图片" : "查看图片，种子 " + result.seed}
      onClick={onSelect}
    >
      <span className="generation-result-preview">
        {!result.available ? (
          <ImageOff size={22} />
        ) : image.error ? (
          <span>读取失败</span>
        ) : image.url ? (
          <img src={image.url} alt="" loading="lazy" onError={image.failed} />
        ) : (
          <span>读取中…</span>
        )}
      </span>
    </Button>
  );
}

export type ResultCanvasProps = {
  result: ResultSummary;
  onOpen: () => void;
  onUseSeed?: (seed: number) => void;
  onRestore: (draft: Draft) => void;
  onImageOperation: (id: string, kind: ImageOperationAction) => void;
  canMaxEnhance: boolean;
  canInpaint: boolean;
  leadingTools?: ReactNode;
  fallback?: ReactNode;
  onImageLoaded?: () => void;
};

/** Image content owns the surface; all operations are compact floating icon controls. */
export function ResultCanvas({
  result,
  onOpen,
  onUseSeed,
  onRestore,
  onImageOperation,
  canMaxEnhance,
  canInpaint,
  leadingTools,
  fallback,
  onImageLoaded,
}: ResultCanvasProps) {
  const image = useMediaContent(result.assetId, result.mimeType, result.available);
  const [zoom, setZoom] = useState(1);
  const [copyState, setCopyState] = useState("");
  useEffect(() => {
    if (!copyState) return;
    const timer = setTimeout(() => setCopyState(""), 2500);
    return () => clearTimeout(timer);
  }, [copyState]);
  const [decodedUrl, setDecodedUrl] = useState<string | null>(null);
  const decoded = Boolean(image.url && !image.error && decodedUrl === image.url);
  const canZoom = Boolean(image.url && !image.error);
  const copySeed = async () => {
    if (result.seed === null) return;
    try {
      await navigator.clipboard.writeText(String(result.seed));
      setCopyState("种子已复制");
    } catch {
      setCopyState("无法复制种子");
    }
  };
  return (
    <section className="image-viewer" aria-label="图片查看器">
      <div className="image-overlay image-overlay-top" role="toolbar" aria-label="图片操作">
        {leadingTools}
        <ImageResultActions
          assetId={result.assetId}
          available={result.available}
          onRestore={onRestore}
          onImageOperation={onImageOperation}
          canMaxEnhance={canMaxEnhance}
          canInpaint={canInpaint}
        />
        <span className="image-tool-divider" />
        <IconButton label="生成参数与来源" onClick={onOpen}>
          <Info size={17} />
        </IconButton>
        {image.url && (
          <a
            className="image-icon-link"
            href={image.url}
            download={resultFilename(result)}
            aria-label="保存原图"
            title="保存原图"
          >
            <Download size={17} />
          </a>
        )}
      </div>
      <div className={"generation-canvas" + (canZoom ? " generation-canvas-viewer" : "")}>
        {!result.available ? (
          <div className="generation-canvas-status">
            <ImageOff size={28} />
            <p>图片文件缺失或不完整</p>
          </div>
        ) : image.error ? (
          <div className="generation-canvas-status generation-danger">
            <p>{image.error}</p>
            <Button onClick={image.retry}>重试读取</Button>
          </div>
        ) : image.url ? (
          <div
            className="generation-canvas-image-stage"
            style={{ width: Math.max(1, zoom) * 100 + "%", height: Math.max(1, zoom) * 100 + "%" }}
          >
            {!decoded && fallback}
            <img
              style={{
                width: Math.min(1, zoom) * 100 + "%",
                height: Math.min(1, zoom) * 100 + "%",
                visibility: !decoded && fallback ? "hidden" : undefined,
              }}
              src={image.url}
              alt={result.seed === null ? "生成图片" : "生成图片，种子 " + result.seed}
              onError={image.failed}
              onLoad={() => {
                setDecodedUrl(image.url);
                onImageLoaded?.();
              }}
            />
          </div>
        ) : (
          (fallback ?? <output className="generation-muted">正在读取图片…</output>)
        )}
      </div>
      {result.operation.kind === "generation" && (
        <div className="image-overlay image-overlay-bottom-left">
          <input
            className="image-seed"
            aria-label="样本种子"
            readOnly
            value={result.seed ?? "种子未知"}
          />
          <IconButton
            label="将种子填入生成参数"
            disabled={result.seed === null || !onUseSeed}
            onClick={() => result.seed !== null && onUseSeed?.(result.seed)}
          >
            <ArrowDownToLine size={16} />
          </IconButton>
          <IconButton
            label="复制种子"
            disabled={result.seed === null}
            onClick={() => void copySeed()}
          >
            <Copy size={16} />
          </IconButton>
          {copyState && <output className="image-copy-status">{copyState}</output>}
        </div>
      )}
      <div className="image-overlay image-overlay-bottom-right" role="toolbar" aria-label="缩放">
        <IconButton
          label="缩小"
          disabled={!canZoom || zoom <= 0.25}
          onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}
        >
          <Minus size={16} />
        </IconButton>
        <IconButton label="适应画布" disabled={!canZoom} onClick={() => setZoom(1)}>
          <Focus size={16} />
        </IconButton>
        <IconButton
          label="放大"
          disabled={!canZoom || zoom >= 4}
          onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
        >
          <Plus size={16} />
        </IconButton>
      </div>
    </section>
  );
}

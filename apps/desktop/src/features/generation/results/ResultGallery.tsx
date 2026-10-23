import { useEffect, useState } from "react";
import { Image, ImageOff, Info, Minus, Plus } from "lucide-react";
import type { Draft } from "../../../bindings/workbench";
import type { ResultSummary } from "../../../bindings/generation";
import { Button, IconButton } from "../../../shared/ui";
import { ResultDetail } from "./ResultDetail";
import { useMediaContent } from "../../media/useMediaContent";
import { resultFilename } from "./result-file";
import { ImageResultActions } from "./ImageResultActions";
import type { ImageOperationAction } from "../../inputs/image-operation";

function ResultTile({
  result,
  selected,
  onSelect,
}: {
  result: ResultSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const image = useMediaContent(result.assetId, "image/png", result.available, "thumbnail");
  return (
    <div className="generation-result-tile">
      <Button
        className={`generation-result-open ${selected ? "selected" : ""}`}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`选择结果：${new Date(result.createdAt).toLocaleString()}${result.seed === null ? "" : `，样本种子 ${result.seed}`}`}
      >
        <span className="generation-result-preview">
          {!result.available ? (
            <span className="generation-muted">
              <ImageOff size={22} />
              媒体缺失
            </span>
          ) : image.error ? (
            <span className="generation-danger">
              <ImageOff size={22} />
              读取失败
            </span>
          ) : image.url ? (
            <img src={image.url} alt="" loading="lazy" onError={image.failed} />
          ) : (
            <span className="generation-muted">读取中…</span>
          )}
        </span>
      </Button>
      {image.error && (
        <Button className="quiet" onClick={image.retry}>
          重试读取
        </Button>
      )}
    </div>
  );
}

export function ResultCanvas({
  result,
  onOpen,
  onUseSeed,
  onRestore,
  onImageOperation,
  canMaxEnhance,
  canInpaint,
}: {
  result: ResultSummary;
  onOpen: () => void;
  onUseSeed: (seed: number) => void;
  onRestore: (draft: Draft) => void;
  onImageOperation: (id: string, kind: ImageOperationAction) => void;
  canMaxEnhance: boolean;
  canInpaint: boolean;
}) {
  const image = useMediaContent(result.assetId, result.mimeType, result.available);
  const [zoom, setZoom] = useState(1);
  const canZoom = Boolean(image.url && !image.error);
  return (
    <>
      <div className="generation-canvas-toolbar">
        <span className="generation-canvas-metadata generation-muted">
          {result.seed === null ? "样本种子未记录" : `样本种子 ${result.seed}`} ·{" "}
          {new Date(result.createdAt).toLocaleString()}
        </span>
        <div className="generation-view-tools" aria-label="图像查看">
          {result.seed !== null && result.available && (
            <Button className="quiet" onClick={() => onUseSeed(result.seed!)}>
              使用样本种子
            </Button>
          )}
          {image.url && (
            <a className="result-download" href={image.url} download={resultFilename(result)}>
              下载
            </a>
          )}
          <IconButton
            className="quiet"
            label="缩小图像"
            disabled={!canZoom || zoom <= 0.25}
            onClick={() => setZoom((value) => Math.max(0.25, value - 0.25))}
          >
            <Minus size={14} />
          </IconButton>
          <output className="generation-zoom-value" aria-label="相对适应画布的缩放比例">
            {Math.round(zoom * 100)}%
          </output>
          <IconButton
            className="quiet"
            label="放大图像"
            disabled={!canZoom || zoom >= 4}
            onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
          >
            <Plus size={14} />
          </IconButton>
          <Button className="quiet" disabled={!canZoom} onClick={() => setZoom(1)}>
            适应
          </Button>
          <Button className="quiet" onClick={onOpen}>
            <Info size={14} />
            详情
          </Button>
        </div>
      </div>
      <ImageResultActions
        assetId={result.assetId}
        available={result.available}
        onRestore={onRestore}
        onImageOperation={onImageOperation}
        canMaxEnhance={canMaxEnhance}
        canInpaint={canInpaint}
      />
      <div className={`generation-canvas ${canZoom ? "generation-canvas-viewer" : ""}`}>
        {!result.available ? (
          <div className="generation-canvas-status">
            <ImageOff size={28} />
            <p>图像不可用</p>
            <small>文件缺失或不完整</small>
          </div>
        ) : image.error ? (
          <div className="generation-canvas-status generation-danger">
            <ImageOff size={28} />
            <p>{image.error}</p>
            <Button onClick={image.retry}>重试读取</Button>
          </div>
        ) : image.url ? (
          <div
            className="generation-canvas-image-stage"
            style={{ width: `${Math.max(1, zoom) * 100}%`, height: `${Math.max(1, zoom) * 100}%` }}
          >
            <img
              style={{
                width: `${Math.min(1, zoom) * 100}%`,
                height: `${Math.min(1, zoom) * 100}%`,
              }}
              src={image.url}
              alt={result.seed === null ? "生成结果" : `生成结果，样本种子 ${result.seed}`}
              onError={image.failed}
            />
          </div>
        ) : (
          <output className="generation-muted">正在读取图像…</output>
        )}
      </div>
    </>
  );
}

export function ResultGallery({
  results,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRestore,
  onUseSeed,
  queryFailed,
  onImageOperation,
  canMaxEnhance,
  canInpaint,
  onViewedAssetChange,
  selectedResultId,
  onSelectResult,
}: {
  results: ResultSummary[] | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => Promise<void>;
  onRestore: (draft: Draft) => void;
  onUseSeed: (seed: number) => void;
  queryFailed: boolean;
  onImageOperation: (id: string, kind: ImageOperationAction) => void;
  canMaxEnhance: boolean;
  canInpaint: boolean;
  onViewedAssetChange?: (id: string | null) => void;
  selectedResultId?: string | null;
  onSelectResult?: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(12);
  const selected =
    results?.find((result) => result.id === (selectedResultId ?? selectedId)) ?? results?.[0];
  const selectResult = (id: string) => {
    setSelectedId(id);
    onSelectResult?.(id);
  };
  const detail = results?.find((result) => result.id === detailId);
  const selectedAssetId = selected?.available ? selected.assetId : null;
  if (selected && selectedId === null && !selectedResultId) setSelectedId(selected.id);
  useEffect(() => {
    onViewedAssetChange?.(selectedAssetId);
  }, [selectedAssetId, onViewedAssetChange]);
  useEffect(() => {
    if (selected && !selectedResultId) onSelectResult?.(selected.id);
  }, [selected, selectedResultId, onSelectResult]);
  return (
    <section className="generation-gallery" aria-label="已保存的生成结果">
      {results === null ? (
        <output className="generation-canvas generation-muted">
          {queryFailed ? "尚未读取结果，请重试查询。" : "正在读取结果…"}
        </output>
      ) : results.length === 0 ? (
        <div className="generation-canvas generation-canvas-empty">
          <Image size={32} />
          <p>尚无生成结果</p>
        </div>
      ) : (
        <>
          {selected && (
            <ResultCanvas
              key={selected.id}
              result={selected}
              onOpen={() => setDetailId(selected.id)}
              onUseSeed={onUseSeed}
              onRestore={onRestore}
              onImageOperation={onImageOperation}
              canMaxEnhance={canMaxEnhance}
              canInpaint={canInpaint}
            />
          )}
          <div className="generation-filmstrip">
            <div className="generation-section-heading">
              <h3>生成记录</h3>
              <span className="generation-muted">{results.length} 张</span>
            </div>
            <div className="generation-result-grid">
              {results.slice(0, visibleCount).map((result) => (
                <ResultTile
                  key={result.id}
                  result={result}
                  selected={result.id === selected?.id}
                  onSelect={() => selectResult(result.id)}
                />
              ))}
              {results.length > visibleCount && (
                <Button
                  className="generation-show-more"
                  onClick={() => setVisibleCount((value) => value + 12)}
                >
                  更多（{results.length - visibleCount}）
                </Button>
              )}
            </div>
            {hasMore && (
              <Button disabled={loadingMore} onClick={() => void onLoadMore?.()}>
                {loadingMore ? "正在读取…" : "读取更早结果"}
              </Button>
            )}
          </div>
        </>
      )}
      {detail && (
        <ResultDetail
          key={detail.id}
          result={detail}
          onClose={() => setDetailId(null)}
          onRestore={onRestore}
          onUseSeed={onUseSeed}
          onImageOperation={onImageOperation}
          canMaxEnhance={canMaxEnhance}
          canInpaint={canInpaint}
        />
      )}
    </section>
  );
}

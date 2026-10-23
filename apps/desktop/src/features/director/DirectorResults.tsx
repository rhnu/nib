import { useMediaQuery } from "../media/useMediaQuery";
import { resultsApi } from "../generation/results/api";
import { summarizeResult } from "../generation/jobs/summary";
import { useJobData } from "../generation/jobs/job-context";
import { useState } from "react";
import { ChevronDown, Columns2, Info, RotateCw } from "lucide-react";
import type { ResultSummary } from "../../bindings/generation";
import type { DirectorToolKind, Draft } from "../../bindings/workbench";
import { ActionsMenu, Button, Notice } from "../../shared/ui";
import { AssetImage } from "../media/AssetImage";
import { useMediaAsset } from "../media/useMediaAsset";
import { ImageResultActions } from "../generation/results/ImageResultActions";
import { ResultDetail } from "../generation/results/ResultDetail";
import { useMediaContent } from "../media/useMediaContent";
import { resultFilename } from "../generation/results/result-file";
import type { ImageOperationAction } from "../inputs/image-operation";
import { directorOutputLabel, directorToolLabels } from "./model";

function SourceFrame({ id, title }: { id: string | null; title: string }) {
  const media = useMediaAsset(id);
  return (
    <section className="director-image-frame">
      <header>{title}</header>
      <div className="director-image-surface">
        {media.error ? (
          <Notice actions={<Button onClick={media.retry}>重试读取</Button>}>{media.error}</Notice>
        ) : media.asset ? (
          <AssetImage asset={media.asset} alt={title} className="director-image" />
        ) : (
          <p className="muted">{id ? "正在读取输入…" : "未选择输入图片"}</p>
        )}
      </div>
    </section>
  );
}

function OutputFrame({ result }: { result: ResultSummary | null }) {
  const image = useMediaContent(
    result?.assetId ?? null,
    result?.mimeType ?? "image/png",
    result?.available ?? false,
  );
  return (
    <section className="director-image-frame">
      <header>{result ? directorOutputLabel(result) : "输出"}</header>
      <div className="director-image-surface">
        {!result ? (
          <p className="muted">尚无此工具的输出</p>
        ) : !result.available ? (
          <p className="generation-danger">输出文件缺失或不完整</p>
        ) : image.error ? (
          <Notice actions={<Button onClick={image.retry}>重试读取</Button>}>{image.error}</Notice>
        ) : image.url ? (
          <img
            src={image.url}
            alt={`导演工具输出 ${result.sampleIndex + 1}`}
            className="director-image"
            onError={image.failed}
          />
        ) : (
          <output className="muted">正在读取输出…</output>
        )}
      </div>
      {image.url && result && (
        <a
          className="result-download director-download"
          href={image.url}
          download={resultFilename(result)}
        >
          保存文件
        </a>
      )}
    </section>
  );
}

function OutputThumbnail({
  result,
  selected,
  onSelect,
}: {
  result: ResultSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const image = useMediaContent(result.assetId, "image/png", result.available, "thumbnail");
  const label = directorOutputLabel(result);
  return (
    <Button
      className={`director-thumbnail ${selected ? "is-selected" : ""}`}
      aria-pressed={selected}
      aria-label={`${label}，${new Date(result.createdAt).toLocaleString()}`}
      title={`${label} · ${new Date(result.createdAt).toLocaleString()}`}
      onClick={onSelect}
    >
      {image.url ? (
        <img src={image.url} alt="" onError={image.failed} />
      ) : (
        <span>{!result.available ? "文件不可用" : image.error ? "读取失败" : "读取中…"}</span>
      )}
      <span>{label}</span>
    </Button>
  );
}

export function DirectorResults({
  tool,
  tools,
  sourceId,
  selectedId,
  onSelect,
  onContinue,
  onUseImage,
  onReference,
  onEncodeVibe,
  onRestore,
  canMaxEnhance = false,
  canInpaint = false,
  canUsePreciseReference = false,
  canUseVibeReference = false,
}: {
  tool: DirectorToolKind;
  tools: DirectorToolKind[];
  sourceId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onContinue: (id: string, tool: DirectorToolKind) => void;
  onUseImage: (id: string, kind: ImageOperationAction) => void;
  onReference: (id: string, kind: "precise" | "vibe") => void;
  onEncodeVibe: (id: string) => void;
  onRestore: (draft: Draft) => void;
  canMaxEnhance?: boolean;
  canInpaint?: boolean;
  canUsePreciseReference?: boolean;
  canUseVibeReference?: boolean;
}) {
  const generation = useJobData();
  const outputs =
    generation.results?.filter(
      (result) =>
        result.kind === "image" &&
        result.operation.kind === "director" &&
        result.operation.tool === tool,
    ) ?? [];
  const retained = useMediaQuery(
    selectedId &&
      generation.results !== null &&
      !generation.results.some((item) => item.id === selectedId)
      ? selectedId
      : null,
    resultsApi.get,
  );
  const retainedSummary = retained.value ? summarizeResult(retained.value) : null;
  const pinned =
    retainedSummary?.operation.kind === "director" && retainedSummary.operation.tool === tool
      ? retainedSummary
      : null;
  const selected =
    outputs.find((result) => result.id === selectedId) ??
    pinned ??
    (retained.loading ? null : outputs[0]) ??
    null;
  const submittedSource =
    selected?.operation.kind === "director" ? selected.operation.assetId : sourceId;
  const [visibleCount, setVisibleCount] = useState(12);
  const [compare, setCompare] = useState(true);
  const [detail, setDetail] = useState<ResultSummary | null>(null);
  const available = selected?.available ?? false;
  return (
    <section className="director-results" aria-label="导演工具输入与输出">
      <header className="director-heading">
        <h2>输入 / 输出</h2>
        <div className="button-group">
          <Button
            className="quiet"
            aria-pressed={compare}
            onClick={() => setCompare((value) => !value)}
          >
            <Columns2 size={14} />
            比较
          </Button>
          <Button
            className="quiet"
            disabled={!selected}
            onClick={() => selected && setDetail(selected)}
          >
            <Info size={14} />
            详情
          </Button>
          <Button
            className="quiet"
            disabled={generation.refreshing}
            onClick={() => void generation.refresh()}
          >
            <RotateCw size={14} />
            刷新
          </Button>
        </div>
      </header>
      {retained.error && (
        <Notice actions={<Button onClick={retained.retry}>重试读取选中结果</Button>}>
          {retained.error}
        </Notice>
      )}
      {generation.queryError && (
        <Notice actions={<Button onClick={() => void generation.refresh()}>重试查询</Button>}>
          {generation.queryError}
        </Notice>
      )}
      <div className={`director-comparison ${compare ? "is-comparing" : ""}`}>
        {compare && <SourceFrame id={submittedSource} title={selected ? "提交源图" : "输入"} />}
        <OutputFrame result={selected} />
      </div>
      {selected && (
        <>
          <div className="director-output-actions">
            <ActionsMenu
              label="继续处理"
              items={tools.map((target) => ({
                label: directorToolLabels[target],
                disabled: !available,
                action: () => onContinue(selected.assetId, target),
              }))}
            >
              继续处理 <ChevronDown size={13} />
            </ActionsMenu>
            <Button
              disabled={!available || !canUsePreciseReference}
              onClick={() => onReference(selected.assetId, "precise")}
            >
              精确参考
            </Button>
            <Button
              disabled={!available || !canUseVibeReference}
              onClick={() => onReference(selected.assetId, "vibe")}
            >
              Vibe 参考
            </Button>
            <Button disabled={!available} onClick={() => onEncodeVibe(selected.assetId)}>
              编码 Vibe
            </Button>
          </div>
          <ImageResultActions
            showDirector={false}
            assetId={selected.assetId}
            available={available}
            onImageOperation={onUseImage}
            onRestore={onRestore}
            canMaxEnhance={canMaxEnhance}
            canInpaint={canInpaint}
          />
        </>
      )}
      <div className="director-output-strip" aria-label="此工具的全部输出">
        {generation.results === null ? (
          <output className="muted">正在读取结果…</output>
        ) : (
          outputs
            .slice(0, visibleCount)
            .map((result) => (
              <OutputThumbnail
                key={result.id}
                result={result}
                selected={selected?.id === result.id}
                onSelect={() => onSelect(result.id)}
              />
            ))
        )}
        {outputs.length > visibleCount && (
          <Button onClick={() => setVisibleCount((count) => count + 12)}>更多输出</Button>
        )}
        {generation.hasMoreResults && (
          <Button
            disabled={generation.loadingMoreResults}
            onClick={() => void generation.loadMoreResults()}
          >
            {generation.loadingMoreResults ? "正在读取…" : "读取更早结果"}
          </Button>
        )}
      </div>
      {detail && (
        <ResultDetail
          result={detail}
          onClose={() => setDetail(null)}
          onRestore={onRestore}
          onImageOperation={onUseImage}
          canMaxEnhance={canMaxEnhance}
          canInpaint={canInpaint}
        />
      )}
    </section>
  );
}

import { useMediaQuery } from "../media/useMediaQuery";
import { resultsApi } from "../generation/results/api";
import { summarizeResult } from "../generation/jobs/summary";
import { useJobData } from "../generation/jobs/job-context";
import { useState } from "react";
import { Columns2 } from "lucide-react";
import type { ResultSummary } from "../../bindings/generation";
import type { DirectorToolKind, Draft } from "../../bindings/workbench";
import { ActionsMenu, Button, IconButton, Notice } from "../../shared/ui";
import { AssetImage } from "../media/AssetImage";
import { useMediaAsset } from "../media/useMediaAsset";
import { ResultCanvas } from "../generation/results/ResultGallery";
import { ResultDetail } from "../generation/results/ResultDetail";
import { useMediaContent } from "../media/useMediaContent";
import type { ImageOperationAction } from "../inputs/image-operation";
import { imageName } from "../media/model";
import { directorOutputLabel, directorToolLabels } from "./model";

function SourceFrame({ id, title }: { id: string | null; title: string }) {
  const media = useMediaAsset(id);
  return (
    <section className="director-image-frame">
      <header>
        {title}
        {media.asset
          ? ` · ${imageName(media.asset)} · ${media.asset.width} × ${media.asset.height}`
          : ""}
      </header>
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
      aria-label={label}
      title={label}
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
    ["results", "detail", selectedId],
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
      <div className={`director-comparison ${compare && selected ? "is-comparing" : ""}`}>
        {(!selected || compare) && (
          <SourceFrame id={submittedSource} title={selected ? "提交源图" : "输入"} />
        )}
        {selected && (
          <ResultCanvas
            key={selected.id}
            result={selected}
            onOpen={() => setDetail(selected)}
            onRestore={onRestore}
            onImageOperation={onUseImage}
            canMaxEnhance={canMaxEnhance}
            canInpaint={canInpaint}
            leadingTools={
              <>
                <IconButton
                  label="比较输入与输出"
                  aria-pressed={compare}
                  onClick={() => setCompare((value) => !value)}
                >
                  <Columns2 size={17} />
                </IconButton>
                <ActionsMenu
                  label="继续使用导演工具输出"
                  items={[
                    ...tools.map((target) => ({
                      label: `继续${directorToolLabels[target]}`,
                      disabled: !available,
                      action: () => onContinue(selected.assetId, target),
                    })),
                    {
                      label: "用作精确参考",
                      disabled: !available || !canUsePreciseReference,
                      action: () => onReference(selected.assetId, "precise"),
                    },
                    {
                      label: "用作 Vibe 参考",
                      disabled: !available || !canUseVibeReference,
                      action: () => onReference(selected.assetId, "vibe"),
                    },
                    {
                      label: "编码 Vibe",
                      disabled: !available,
                      action: () => onEncodeVibe(selected.assetId),
                    },
                  ]}
                />
              </>
            }
          />
        )}
      </div>
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

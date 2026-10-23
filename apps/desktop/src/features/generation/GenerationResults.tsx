import { RotateCw } from "lucide-react";
import { useState } from "react";
import type { CreationOperation, Draft } from "../../bindings/workbench";
import { operationSourceId, type ImageOperationAction } from "../workbench/image-operation";
import { Button, Notice } from "../../shared/ui";
import { useGeneration } from "./generation-context";
import { JobQueue } from "./JobQueue";
import { ResultGallery } from "./ResultGallery";
import { SourceImageView } from "./SourceImageView";
import { ImageResultActions } from "./ImageResultActions";
import { useMediaAsset } from "../media/useMediaAsset";

export function GenerationResults({
  onRestore,
  onUseSeed,
  operation,
  onImageOperation,
  canMaxEnhance,
  canInpaint,
  onViewedAssetChange,
}: {
  onRestore: (draft: Draft) => void;
  onUseSeed: (seed: number) => void;
  operation: CreationOperation;
  onImageOperation: (id: string, kind: ImageOperationAction) => void;
  canMaxEnhance: boolean;
  canInpaint: boolean;
  onViewedAssetChange?: (id: string | null) => void;
}) {
  const { results, queryError, refreshing, refresh } = useGeneration();
  const sourceId = operationSourceId(operation);
  const source = useMediaAsset(sourceId);
  const [view, setView] = useState<"source" | "results">("results");
  const showSource = Boolean(sourceId && (view === "source" || results?.length === 0));
  return (
    <section className="generation-results" aria-label="生成任务与结果">
      <header className="generation-results-heading">
        <h2>生成结果</h2>
        {sourceId && (
          <div className="button-group" aria-label="画布内容">
            <Button className="quiet" aria-pressed={showSource} onClick={() => setView("source")}>
              源图
            </Button>
            <Button
              className="quiet"
              aria-pressed={!showSource}
              disabled={results?.length === 0}
              onClick={() => setView("results")}
            >
              结果
            </Button>
          </div>
        )}
        <Button className="quiet" disabled={refreshing} onClick={() => void refresh()}>
          <RotateCw size={13} />
          {refreshing ? "正在刷新…" : "刷新"}
        </Button>
      </header>
      {queryError && (
        <Notice
          actions={
            <Button disabled={refreshing} onClick={() => void refresh()}>
              重试查询
            </Button>
          }
        >
          {queryError}
        </Notice>
      )}
      <div className="generation-results-content">
        {showSource && sourceId ? (
          <>
            <ImageResultActions
              assetId={sourceId}
              available={source.asset?.available ?? false}
              onRestore={onRestore}
              onImageOperation={onImageOperation}
              canMaxEnhance={canMaxEnhance}
              canInpaint={canInpaint}
            />
            <SourceImageView key={sourceId} id={sourceId} />
          </>
        ) : (
          <ResultGallery
            results={results?.filter((result) => result.kind === "image") ?? null}
            onRestore={onRestore}
            onUseSeed={onUseSeed}
            queryFailed={queryError !== null}
            onImageOperation={onImageOperation}
            canMaxEnhance={canMaxEnhance}
            canInpaint={canInpaint}
            onViewedAssetChange={onViewedAssetChange}
          />
        )}
        <JobQueue />
      </div>
    </section>
  );
}

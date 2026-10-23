import { useFeedback } from "../jobs/feedback-context";
import { useJobData } from "../jobs/job-context";
import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  CreationOperation,
  Draft,
  VibeEncodingInput,
  VibeReferenceInput,
} from "../../../bindings/workbench";
import { operationSourceId, type ImageOperationAction } from "../../inputs/image-operation";
import { Button, Notice } from "../../../shared/ui";
import { JobQueue } from "../jobs/JobQueue";
import { ResultGallery } from "./ResultGallery";
import { SourceImageView } from "./SourceImageView";
import { ImageResultActions } from "./ImageResultActions";
import { useMediaAsset } from "../../media/useMediaAsset";
import { VibeResults } from "../../vibes/VibeResults";
import { LivePreview } from "../jobs/LivePreview";
import { initialGenerationViewState, type GenerationViewState } from "./generation-view-state";

export function GenerationResults({
  onRestore,
  onUseSeed,
  operation,
  onImageOperation,
  canMaxEnhance,
  canInpaint,
  onViewedAssetChange,
  onAddVibeReference,
  onEncodeVibe,
  viewState,
  onViewStateChange,
}: {
  onRestore: (draft: Draft) => void;
  onUseSeed: (seed: number) => void;
  operation: CreationOperation;
  onImageOperation: (id: string, kind: ImageOperationAction) => void;
  canMaxEnhance: boolean;
  canInpaint: boolean;
  onViewedAssetChange?: (id: string | null) => void;
  onAddVibeReference?: (reference: VibeReferenceInput) => void;
  onEncodeVibe?: (input: VibeEncodingInput) => void;
  viewState?: GenerationViewState;
  onViewStateChange?: (value: GenerationViewState) => void;
}) {
  const {
    jobs,
    results,
    queryError,
    refreshing,
    refresh,
    hasMoreResults,
    loadingMoreResults,
    loadMoreResults,
  } = useJobData();
  const { feedbackError, reconnectFeedback } = useFeedback();
  const sourceId = operationSourceId(operation);
  const source = useMediaAsset(sourceId);
  const [localView, setLocalView] = useState(initialGenerationViewState);
  const state = viewState ?? localView;
  const updateView = (patch: Partial<GenerationViewState>) => {
    const next = { ...state, ...patch };
    setLocalView(next);
    onViewStateChange?.(next);
  };
  const { view, resultKind } = state;
  const imageResults = results?.filter((result) => result.kind === "image") ?? null;
  const vibeResults = results?.filter((result) => result.kind === "vibe") ?? [];
  const showVibes = resultKind === "vibe" || (imageResults?.length === 0 && vibeResults.length > 0);
  const hasActiveJobs =
    jobs?.some((job) => job.status === "queued" || job.status === "running") ?? false;
  const showLive = view === "live";
  const showSource = !showLive && Boolean(sourceId && (view === "source" || results?.length === 0));
  useEffect(() => {
    if (showLive || showVibes || showSource) onViewedAssetChange?.(showSource ? sourceId : null);
  }, [showLive, showVibes, showSource, sourceId, onViewedAssetChange]);
  return (
    <section className="generation-results" aria-label="生成任务与结果">
      <header className="generation-results-heading">
        <h2>生成结果</h2>
        <div className="button-group" aria-label="画布内容">
          {(hasActiveJobs || state.liveJobId !== null) && (
            <Button
              className="quiet"
              aria-pressed={showLive}
              onClick={() => updateView({ view: "live" })}
            >
              执行预览
            </Button>
          )}
          {sourceId && (
            <Button
              className="quiet"
              aria-pressed={showSource}
              onClick={() => updateView({ view: "source" })}
            >
              源图
            </Button>
          )}
          <Button
            className="quiet"
            aria-pressed={!showSource && !showLive && !showVibes}
            onClick={() => {
              updateView({ view: "results", resultKind: "image" });
            }}
          >
            结果 {imageResults?.length ?? 0}
          </Button>
          {vibeResults.length > 0 && (
            <Button
              className="quiet"
              aria-pressed={showVibes && view === "results"}
              onClick={() => {
                updateView({ view: "results", resultKind: "vibe" });
              }}
            >
              Vibe {vibeResults.length}
            </Button>
          )}
        </div>
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
      {feedbackError && (
        <Notice actions={<Button onClick={reconnectFeedback}>重新连接预览</Button>}>
          执行反馈连接失败：{feedbackError}
        </Notice>
      )}
      <div className="generation-results-content">
        {showLive ? (
          <LivePreview
            jobId={state.liveJobId}
            sampleIndex={state.liveSampleIndex}
            onSelect={(liveJobId, liveSampleIndex) => updateView({ liveJobId, liveSampleIndex })}
            onOpenResult={(result) =>
              updateView({
                view: "results",
                resultKind: result.kind === "vibe" ? "vibe" : "image",
                selectedResultId: result.id,
              })
            }
          />
        ) : showSource && sourceId ? (
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
        ) : showVibes ? (
          <VibeResults
            hasMore={hasMoreResults}
            loadingMore={loadingMoreResults}
            onLoadMore={loadMoreResults}
            results={vibeResults}
            onAddReference={onAddVibeReference}
            onEncode={onEncodeVibe}
          />
        ) : (
          <ResultGallery
            results={imageResults}
            hasMore={hasMoreResults}
            loadingMore={loadingMoreResults}
            onLoadMore={loadMoreResults}
            onRestore={onRestore}
            onUseSeed={onUseSeed}
            queryFailed={queryError !== null}
            onImageOperation={onImageOperation}
            canMaxEnhance={canMaxEnhance}
            canInpaint={canInpaint}
            onViewedAssetChange={onViewedAssetChange}
            selectedResultId={state.selectedResultId}
            onSelectResult={(selectedResultId) => updateView({ selectedResultId })}
          />
        )}
        <JobQueue
          onViewJob={(liveJobId) => updateView({ view: "live", liveJobId, liveSampleIndex: 0 })}
        />
      </div>
    </section>
  );
}

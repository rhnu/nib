import { t, useTranslation } from "@/shared/i18n";
import { useStore } from "zustand";
import { useResultViewStore, type ResultSelection as Selection } from "./result-view-state";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Grid2X2, Image, ListOrdered, LoaderCircle, Scan } from "lucide-react";
import type { CreationOperation, Draft } from "@/bindings/workbench";
import type { ResultSummary } from "@/bindings/generation";
import { operationSourceId, type ImageOperationAction } from "@/features/inputs/image-operation";
import { Button, IconButton, Notice } from "@/shared/ui";
import { useFeedback } from "../jobs/feedback-context";
import { useJobData } from "../jobs/job-context";
import { errorMessage } from "@/shared/host/error";
import { jobsApi } from "../jobs/api";
import { summarizeJob } from "../jobs/summary";
import { JobQueue } from "../jobs/job-queue";
import { ResultCanvas, ResultTile } from "./result-gallery";
import { ResultDetail } from "./result-detail";
import { RequestCanvas } from "./request-canvas";
import { SourceImageView } from "./source-image-view";
import { ImageResultActions } from "./image-result-actions";
import { useMediaAsset } from "@/features/media/use-media-asset";

export function GenerationResults({
  onRestore,
  onUseSeed,
  operation,
  onImageOperation,
  canMaxEnhance,
  canInpaint,
  onViewedAssetChange,
  recentImageLimit = 20,
  gallery = false,
}: {
  onRestore: (draft: Draft) => void;
  onUseSeed: (seed: number) => void;
  operation: CreationOperation;
  onImageOperation: (id: string, kind: ImageOperationAction) => void;
  canMaxEnhance: boolean;
  canInpaint: boolean;
  onViewedAssetChange?: (id: string | null) => void;
  recentImageLimit?: number;
  gallery?: boolean;
}) {
  useTranslation();

  const {
    jobs,
    results,
    lastSubmission,
    queryError,
    refreshing,
    refresh,
    hasMoreResults,
    loadingMoreResults,
    loadMoreResults,
  } = useJobData();
  const { feedbackError, reconnectFeedback } = useFeedback();
  const view = useResultViewStore(gallery);
  const selection = useStore(view, (state) => state.selection);
  const seenBatch = useStore(view, (state) => state.seenBatch);

  const setSelection = useCallback(
    (selection: Selection | null) => view.setState({ selection }),
    [view],
  );

  const [queueOpen, setQueueOpen] = useState(false);
  const [detail, setDetail] = useState<ResultSummary | null>(null);
  useEffect(() => {
    if (gallery || !lastSubmission || lastSubmission.batchId === seenBatch) return;
    const first = lastSubmission.jobs[0];
    view.setState({
      seenBatch: lastSubmission.batchId,
      ...(first && first.submission.kind !== "encodeVibe"
        ? { selection: { kind: "job", id: first.id } as const }
        : {}),
    });
  }, [gallery, lastSubmission, seenBatch, view]);
  const activeJobs =
    jobs?.filter(
      (job) =>
        (job.status === "queued" || job.status === "running") &&
        job.operation.kind !== "encodeVibe",
    ) ?? [];
  const active = [...activeJobs].sort(
    (a, b) =>
      Number(b.status === "running") - Number(a.status === "running") ||
      a.submittedAt - b.submittedAt ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  )[0];
  const activeId = active?.id;
  useEffect(() => {
    if (
      !gallery &&
      selection === null &&
      activeId &&
      (!lastSubmission || lastSubmission.batchId === seenBatch)
    )
      setSelection({ kind: "job", id: activeId });
  }, [gallery, selection, activeId, setSelection, lastSubmission, seenBatch]);
  const currentSelection =
    selection?.kind === "result"
      ? {
          ...selection,
          result: results?.find((result) => result.id === selection.result.id) ?? selection.result,
        }
      : selection;
  const selected =
    currentSelection ??
    (gallery
      ? null
      : active
        ? { kind: "job" as const, id: active.id }
        : results?.[0]
          ? { kind: "result" as const, result: results[0] }
          : null);
  const jobId = selected?.kind === "job" ? selected.id : null;
  const knownJob = jobs?.find((job) => job.id === jobId);
  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => jobsApi.get(jobId!),
    enabled: !!jobId && !knownJob,
  });
  const job = knownJob ?? (jobQuery.data ? summarizeJob(jobQuery.data) : null);
  const sourceId = operationSourceId(operation);
  const source = useMediaAsset(selected?.kind === "source" ? sourceId : null);
  const viewedId =
    selected?.kind === "result"
      ? selected.result.assetId
      : selected?.kind === "source"
        ? sourceId
        : null;
  useEffect(() => {
    onViewedAssetChange?.(viewedId);
  }, [viewedId, onViewedAssetChange]);
  const canvas = { onRestore, onUseSeed, onImageOperation, canMaxEnhance, canInpaint };

  const selectJob = (id: string) => {
    setSelection({ kind: "job", id });
    setQueueOpen(false);
  };

  return (
    <section
      className={"generation-results" + (gallery ? " gallery-page" : "")}
      aria-label={gallery ? t("generation.gallery") : t("generation.previewResults")}
    >
      <div className="generation-view-controls">
        <span className="generation-spacer" />
        {gallery && selection && (
          <IconButton label={t("generation.backToGallery")} onClick={() => setSelection(null)}>
            <Grid2X2 size={17} />
          </IconButton>
        )}
        {!gallery && sourceId && (
          <IconButton
            label={
              selected?.kind === "source"
                ? t("generation.backToResults")
                : t("generation.viewInputImage")
            }
            aria-pressed={selected?.kind === "source"}
            onClick={() => {
              if (selected?.kind === "source") setSelection(view.getState().sourceReturn);
              else {
                view.setState({ sourceReturn: selected });
                setSelection({ kind: "source" });
              }
            }}
          >
            <Scan size={17} />
          </IconButton>
        )}
        <IconButton
          label={t("generation.taskQueue")}
          data-generation-tasks={!gallery || undefined}
          onClick={() => setQueueOpen(true)}
        >
          <ListOrdered size={17} />
        </IconButton>
      </div>
      {queryError && (
        <Notice
          actions={
            <Button disabled={refreshing} onClick={() => void refresh()}>
              {t("generation.retryQuery")}
            </Button>
          }
        >
          {queryError}
        </Notice>
      )}
      {jobQuery.error && (
        <Notice
          actions={
            <Button onClick={() => void jobQuery.refetch()}>{t("generation.retryLoadTask")}</Button>
          }
        >
          {errorMessage(jobQuery.error)}
        </Notice>
      )}
      {feedbackError && (
        <Notice
          actions={<Button onClick={reconnectFeedback}>{t("generation.reconnectPreview")}</Button>}
        >
          {feedbackError}
        </Notice>
      )}
      <div className="generation-results-content">
        {gallery && !selection ? (
          <div className="gallery-scroll">
            <div className="gallery-grid">
              {results?.map((result) => (
                <ResultTile
                  key={result.id}
                  result={result}
                  selected={false}
                  onSelect={() => setSelection({ kind: "result", result })}
                />
              ))}
            </div>
            {!results?.length && (
              <div className="generation-canvas-status">
                <Image size={30} />
                <p>{results ? t("generation.noImages") : t("generation.loadingImages")}</p>
              </div>
            )}
            {hasMoreResults && (
              <Button
                className="gallery-more"
                disabled={loadingMoreResults}
                onClick={() => void loadMoreResults()}
              >
                {loadingMoreResults ? t("generation.loadingMore") : t("generation.loadMore")}
              </Button>
            )}
          </div>
        ) : selected?.kind === "result" ? (
          <ResultCanvas
            key={selected.result.id}
            {...canvas}
            result={selected.result}
            onOpen={() => setDetail(selected.result)}
            leadingTools={
              selected.backJob ? (
                <IconButton
                  label={t("generation.backToAllSamples")}
                  onClick={() => selectJob(selected.backJob!)}
                >
                  <Grid2X2 size={17} />
                </IconButton>
              ) : gallery ? (
                <IconButton
                  label={t("generation.backToGallery")}
                  onClick={() => setSelection(null)}
                >
                  <ArrowLeft size={17} />
                </IconButton>
              ) : undefined
            }
          />
        ) : selected?.kind === "job" && job ? (
          <RequestCanvas
            key={job.id}
            job={job}
            canvas={{ ...canvas, onOpen: setDetail }}
            onSelect={(result) => setSelection({ kind: "result", result, backJob: job.id })}
          />
        ) : selected?.kind === "source" && sourceId ? (
          <div className="image-viewer">
            <div className="image-overlay image-overlay-top">
              <ImageResultActions
                assetId={sourceId}
                available={source.asset?.available ?? false}
                {...canvas}
              />
            </div>
            <SourceImageView id={sourceId} />
          </div>
        ) : (
          <div className="generation-canvas generation-canvas-empty">
            <Image size={32} />
            <p>{jobId ? t("generation.loadingTasks") : t("generation.emptyResultsHint")}</p>
          </div>
        )}
        {!gallery && (
          <div className="generation-filmstrip" aria-label={t("generation.recentImages")}>
            <div className="generation-result-grid">
              {active && (
                <Button
                  className={
                    "generation-result-open active-request-card" +
                    (jobId === active.id ? " selected" : "")
                  }
                  aria-pressed={jobId === active.id}
                  onClick={() => selectJob(active.id)}
                >
                  <LoaderCircle size={22} />
                  <span>
                    {active.status === "running"
                      ? t("generation.generating")
                      : t("generation.queued")}
                  </span>
                  <small>
                    {active.operation.kind === "generation"
                      ? t("generation.sampleCount", { count: active.operation.sampleCount })
                      : t("generation.processing")}
                  </small>
                </Button>
              )}
              {(results ?? []).slice(0, recentImageLimit).map((result) => (
                <div className="generation-result-tile" key={result.id}>
                  <ResultTile
                    result={result}
                    selected={selected?.kind === "result" && selected.result.id === result.id}
                    onSelect={() => setSelection({ kind: "result", result })}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <JobQueue open={queueOpen} onClose={() => setQueueOpen(false)} onViewJob={selectJob} />
      {detail && <ResultDetail result={detail} onClose={() => setDetail(null)} {...canvas} />}
    </section>
  );
}

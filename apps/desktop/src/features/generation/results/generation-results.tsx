import { Button, IconButton, Notice, Col, Row, Grid } from "@/shared/ui";

import { t, useTranslation } from "@/shared/i18n";
import { useStore } from "zustand";
import { useResultViewStore, type ResultSelection as Selection } from "./result-view-state";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Grid2X2, Image, ListOrdered, LoaderCircle, Scan } from "lucide-react";
import type { CreationOperation, Draft } from "@/bindings/workbench";
import type { ResultSummary } from "@/bindings/generation";
import { operationSourceId, type ImageOperationAction } from "@/features/inputs/image-operation";

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
import { nextPreviewJob } from "./preview-follow";

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
  const { feedback, feedbackError, reconnectFeedback } = useFeedback();
  const view = useResultViewStore(gallery);
  const selection = useStore(view, (state) => state.selection);
  const seenBatch = useStore(view, (state) => state.seenBatch);
  const followedJobId = useStore(view, (state) => state.followedJobId);
  const previewBatchId =
    lastSubmission?.batchId ??
    jobs?.find((job) => job.status === "running" && job.operation.kind !== "encodeVibe")?.batchId ??
    jobs?.find((job) => job.id === followedJobId)?.batchId ??
    null;
  const readyJobId = nextPreviewJob(jobs ?? [], feedback, previewBatchId, followedJobId);

  const setSelection = useCallback(
    (selection: Selection | null) => view.setState({ selection }),
    [view],
  );

  const [queueOpen, setQueueOpen] = useState(false);
  const [detail, setDetail] = useState<ResultSummary | null>(null);
  useEffect(() => {
    if (gallery) return;
    if (lastSubmission && lastSubmission.batchId !== seenBatch) {
      const first = lastSubmission.jobs[0];
      view.setState({
        seenBatch: lastSubmission.batchId,
        followedJobId: first?.id ?? null,
        ...(first && first.submission.kind !== "encodeVibe"
          ? { selection: { kind: "job", id: first.id } as const }
          : {}),
      });
      return;
    }
    // Keep the previous image visible until the later request has image content.
    if (readyJobId)
      view.setState({
        followedJobId: readyJobId,
        selection: { kind: "job", id: readyJobId },
      });
  }, [gallery, lastSubmission, seenBatch, readyJobId, view]);
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
    <Col
      gap={0}
      align="stretch"
      as="section"
      className={
        "generation-results [&_button]:shrink-0 flex flex-col min-h-0 min-w-0 h-full overflow-hidden bg-background" +
        (gallery ? " gallery-page h-full" : "")
      }
      aria-label={gallery ? t("generation.gallery") : t("generation.previewResults")}
    >
      <Row
        gap={0}
        className="generation-view-controls flex items-center gap-space-1 py-[3px] px-[7px] h-[34px] shrink-0 border-b border-line-subtle"
      >
        <span className="generation-spacer flex-1" />
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
      </Row>
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
      <Col
        gap={0}
        align="stretch"
        className="generation-results-content [&_>_.image-viewer]:h-0 flex flex-col flex-1 min-h-0"
      >
        {gallery && !selection ? (
          <div className="gallery-scroll overflow-auto p-space-5 flex-1">
            <Grid
              gap={0}
              align="stretch"
              className="gallery-grid [&_.generation-result-preview]:aspect-[1] [&_.generation-result-preview]:h-auto grid grid-cols-[repeat(auto-fill,_minmax(150px,_1fr))] gap-space-3"
            >
              {results?.map((result) => (
                <ResultTile
                  key={result.id}
                  result={result}
                  selected={false}
                  onSelect={() => setSelection({ kind: "result", result })}
                />
              ))}
            </Grid>
            {!results?.length && (
              <Col
                gap={0}
                align="stretch"
                className="generation-canvas-status flex flex-col items-center gap-space-3 text-muted text-label"
              >
                <Image size={30} />
                <p>{results ? t("generation.noImages") : t("generation.loadingImages")}</p>
              </Col>
            )}
            {hasMoreResults && (
              <Button
                className="gallery-more flex my-space-5 mx-auto"
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
          <Row
            gap={0}
            align="stretch"
            className="image-viewer relative flex flex-1 min-h-0 min-w-0 overflow-hidden [&_>_.generation-canvas]:min-h-0"
          >
            <Row
              gap={0}
              className="image-overlay [&_.icon-button]:w-[30px] [&_.icon-button]:h-[30px] [&_.icon-button]:min-h-[30px] [&_.icon-button]:[flex:0_0_30px] [&_.icon-button]:inline-flex [&_.icon-button]:items-center [&_.icon-button]:justify-center [&_.icon-button]:text-inherit [&_.icon-button]:border-0 [&_.icon-button]:bg-transparent [&_.icon-button]:rounded-control [&_.icon-button]:no-underline [&_.generation-image-actions]:contents absolute z-[2] flex items-center gap-[2px] p-[3px] border border-line rounded-control bg-[color-mix(in_srgb,_var(--surface)_92%,_transparent)] [box-shadow:0_2px_12px_#0003] image-overlay-top left-[50%] top-[10px] [transform:translateX(-50%)] max-w-[calc(100%_-_16px)] whitespace-nowrap overflow-x-auto"
            >
              <ImageResultActions
                assetId={sourceId}
                available={source.asset?.available ?? false}
                {...canvas}
              />
            </Row>
            <SourceImageView id={sourceId} />
          </Row>
        ) : (
          <Col
            gap={0}
            align="stretch"
            className="generation-canvas [&_p]:m-0 justify-center flex-1 min-h-[180px] min-w-0 overflow-hidden p-space-5 generation-canvas-empty flex flex-col items-center gap-space-3 text-muted text-label"
          >
            <Image size={32} />
            <p>{jobId ? t("generation.loadingTasks") : t("generation.emptyResultsHint")}</p>
          </Col>
        )}
        {!gallery && (
          <div
            className="generation-filmstrip shrink-0 py-[7px] px-space-3 border-t border-line bg-panel"
            aria-label={t("generation.recentImages")}
          >
            <Row
              gap={0}
              className="generation-result-grid flex items-start gap-space-2 overflow-x-auto [padding:1px_1px_5px] pb-[2px]"
            >
              {active && (
                <Button
                  className={
                    "generation-result-open [&.selected]:border-accent p-0 flex flex-col whitespace-normal overflow-hidden rounded-control active-request-card [&_small]:text-muted [&_small]:text-[10px] min-w-[84px] w-[84px] h-[84px] items-center justify-center gap-[3px] text-caption [flex:0_0_84px]" +
                    (jobId === active.id ? " selected" : "")
                  }
                  aria-pressed={jobId === active.id}
                  onClick={() => selectJob(active.id)}
                >
                  <LoaderCircle
                    size={22}
                    className={active.status === "running" ? "spin" : undefined}
                    aria-hidden
                  />
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
                <div className="generation-result-tile min-w-0 w-[84px] shrink-0" key={result.id}>
                  <ResultTile
                    result={result}
                    selected={selected?.kind === "result" && selected.result.id === result.id}
                    onSelect={() => setSelection({ kind: "result", result })}
                  />
                </div>
              ))}
            </Row>
          </div>
        )}
      </Col>
      <JobQueue open={queueOpen} onClose={() => setQueueOpen(false)} onViewJob={selectJob} />
      {detail && <ResultDetail result={detail} onClose={() => setDetail(null)} {...canvas} />}
    </Col>
  );
}

import { Button, IconButton, Modal, Notice, notify, Grid, Row } from "@/shared/ui";

import { t, useTranslation, useMessageState, errorMessage } from "@/shared/i18n";
import { useFeedback } from "./feedback-context";
import { useJobData } from "./job-context";
import { jobsApi } from "./api";
import { useRef, useState } from "react";
import { Eye, ListOrdered, RotateCw, Square, X } from "lucide-react";
import type { JobSummary } from "@/bindings/generation";

import { JobRetryDialog } from "./job-retry-dialog";
import { operationSummaryLabel } from "./summary";
import { jobFeedbackText } from "./feedback-state";
import { JobCostSummary } from "./job-cost-summary";

export function JobQueue({
  open,
  onClose,
  onViewJob,
}: {
  open?: boolean;
  onClose?: () => void;
  onViewJob?: (id: string) => void;
}) {
  useTranslation();

  const {
    jobs,
    acceptJob,
    stopBatch,
    stoppingBatches,
    queryError,
    hasMoreJobs,
    loadingMoreJobs,
    loadMoreJobs,
  } = useJobData();
  const { feedback, jobObservations } = useFeedback();
  const [localOpen, setLocalOpen] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const pendingRef = useRef(new Set<string>());
  const [error, setError] = useMessageState();
  const [retryJob, setRetryJob] = useState<JobSummary | null>(null);

  async function cancel(id: string) {
    if (pendingRef.current.has(id)) return;
    pendingRef.current.add(id);
    setPending([...pendingRef.current]);
    setError(null);
    try {
      const record = await jobsApi.cancel(id);
      acceptJob(record);
      if (record.status === "running") notify(() => t("generation.requestAlreadyStarted"));
    } catch (cause) {
      setError(cause);
    } finally {
      pendingRef.current.delete(id);
      setPending([...pendingRef.current]);
    }
  }

  const batches = new Map<string, JobSummary[]>();
  for (const job of jobs ?? []) {
    const list = batches.get(job.batchId) ?? [];
    list.push(job);
    batches.set(job.batchId, list);
  }
  const groups = [...batches.values()].sort((a, b) => b[0]!.submittedAt - a[0]!.submittedAt);
  return (
    <>
      {open === undefined && (
        <IconButton label={t("generation.taskQueue")} onClick={() => setLocalOpen(true)}>
          <ListOrdered size={17} />
        </IconButton>
      )}
      <Modal
        open={open ?? localOpen}
        onClose={() => {
          onClose?.();
          setLocalOpen(false);
        }}
        showClose={false}
        title={t("generation.taskQueue")}
        className="queue-drawer [&.modal]:inset-[var(--titlebar-height)_0_0_auto] [&.modal]:[transform:none] [&.modal]:w-[min(460px,_95vw)] [&.modal]:max-w-[95vw] [&.modal]:h-[calc(100dvh_-_var(--titlebar-height))] [&.modal]:max-h-[calc(100dvh_-_var(--titlebar-height))] [&.modal]:rounded-[0] [&_.generation-job-description_>_span]:w-auto [&.modal]:py-space-3 [&.modal]:px-[10px] [&_.generation-job_+_.generation-job]:border-t [&_.generation-job_+_.generation-job]:border-line-subtle [&_.generation-job-list]:max-h-[none] [&_.generation-job-list]:overflow-visible [&_.generation-job-list]:gap-0 [&_.generation-job]:border-0 [&_.generation-job]:rounded-[0] [&_.generation-job]:bg-transparent [&_.generation-job]:py-space-2 [&_.generation-job]:px-0 [&_.generation-job]:gap-space-1 [&_.generation-job-description]:gap-y-[3px] [&_.generation-job-description]:gap-x-space-3 [&_.generation-job-cost]:text-caption"
      >
        <Grid
          gap={0}
          align="stretch"
          columns={1}
          className="queue-drawer-body overflow-auto p-0 grid content-start gap-space-3"
        >
          {!jobs ? (
            <output>{queryError ?? t("generation.loadingTasks")}</output>
          ) : !jobs.length ? (
            <p className="generation-muted text-muted">{t("generation.noTasks")}</p>
          ) : (
            groups.map((group) => {
              const ordered = [...group].sort((a, b) => a.requestIndex - b.requestIndex);
              const queued = ordered.filter((job) => job.status === "queued");
              const running = ordered.some((job) => job.status === "running");
              const batchId = ordered[0]!.batchId;
              return (
                <Grid
                  gap={0}
                  align="stretch"
                  columns={1}
                  as="section"
                  className="queue-batch [&_>_header]:items-center [&_>_header]:text-label [&_>_header_>_span]:flex-1 [&_>_header_>_span]:text-muted [&_>_header_>_span]:text-caption [&_>_header]:min-h-[26px] [&_>_header]:flex [&_>_header]:gap-space-3 grid gap-space-2"
                  key={ordered[0]!.batchId}
                >
                  <Row gap={0} as="header">
                    <strong>{operationSummaryLabel(ordered[0]!.operation)}</strong>
                    <span>{t("generation.requestCount", { count: ordered[0]!.requestCount })}</span>
                    {queued.length > 0 && (
                      <IconButton
                        label={
                          running
                            ? t("generation.stopRemainingRequests")
                            : t("generation.cancelQueuedRequests")
                        }
                        title={t("generation.stopRequestsHelp")}
                        disabled={
                          stoppingBatches.includes(batchId) ||
                          queued.some((job) => pending.includes(job.id))
                        }
                        aria-busy={stoppingBatches.includes(batchId)}
                        onClick={() => {
                          setError(null);
                          void stopBatch(batchId).catch(setError);
                        }}
                      >
                        <Square size={13} fill="currentColor" />
                      </IconButton>
                    )}
                  </Row>
                  <Grid
                    gap={0}
                    align="stretch"
                    columns={1}
                    as="ol"
                    className="generation-job-list grid gap-space-2 list-none p-0 m-0 max-h-[220px] overflow-auto"
                  >
                    {ordered.map((job) => (
                      <li
                        key={job.id}
                        className={`generation-job [&.generation-job-running]:border-[color-mix(in_srgb,var(--accent)_40%,var(--line))] [&.generation-job-queued]:border-[color-mix(in_srgb,var(--accent)_40%,var(--line))] flex items-start gap-space-3 py-space-2 px-space-3 border border-line-subtle rounded-control bg-background generation-job-${job.status}`}
                      >
                        <Row
                          gap={0}
                          align="stretch"
                          className="generation-job-description [&_strong]:text-label [&_time]:text-caption [&_time]:text-muted [&_>_span]:text-caption [&_>_span]:text-muted [&_small]:text-caption [&_small]:text-muted [&_>_span]:w-full [&_small]:w-full [&_.generation-danger]:text-danger flex flex-wrap gap-y-[3px] gap-x-space-3 flex-1 min-w-0 wrap-anywhere"
                        >
                          <strong>
                            {job.requestIndex + 1}. {jobFeedbackText(job, feedback[job.id])}
                          </strong>
                          {job.operation.kind === "generation" && (
                            <span>
                              {t("generation.sampleCount", { count: job.operation.sampleCount })}
                            </span>
                          )}
                          {job.error && (
                            <span className="generation-danger text-danger">
                              {errorMessage(job.error)}
                            </span>
                          )}
                          <JobCostSummary
                            job={
                              jobObservations[job.id]
                                ? { ...job, observation: jobObservations[job.id]! }
                                : job
                            }
                          />
                        </Row>
                        {onViewJob && job.operation.kind !== "encodeVibe" && (
                          <IconButton
                            label={t("generation.viewRequest")}
                            onClick={() => onViewJob(job.id)}
                          >
                            <Eye size={15} />
                          </IconButton>
                        )}
                        {job.status === "queued" && (
                          <IconButton
                            label={t("generation.cancelRequest")}
                            disabled={pending.includes(job.id) || stoppingBatches.includes(batchId)}
                            onClick={() => void cancel(job.id)}
                          >
                            <X size={15} />
                          </IconButton>
                        )}
                        {(job.status === "failed" ||
                          job.status === "cancelled" ||
                          job.status === "interrupted") && (
                          <IconButton
                            label={t("generation.resubmit")}
                            onClick={() => setRetryJob(job)}
                          >
                            <RotateCw size={15} />
                          </IconButton>
                        )}
                      </li>
                    ))}
                  </Grid>
                </Grid>
              );
            })
          )}
          {hasMoreJobs && (
            <Button disabled={loadingMoreJobs} onClick={() => void loadMoreJobs()}>
              {loadingMoreJobs ? t("generation.loadingMore") : t("generation.loadEarlierTasks")}
            </Button>
          )}
          {error && <Notice>{error}</Notice>}
        </Grid>
        {retryJob && <JobRetryDialog job={retryJob} onClose={() => setRetryJob(null)} />}
      </Modal>
    </>
  );
}

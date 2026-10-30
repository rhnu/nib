import { t, useTranslation, useMessageState, errorMessage } from "@/shared/i18n";
import { useFeedback } from "./feedback-context";
import { useJobData } from "./job-context";
import { jobsApi } from "./api";
import { useRef, useState } from "react";
import { Eye, ListOrdered, RotateCw, X } from "lucide-react";
import type { JobSummary } from "@/bindings/generation";
import { Button, IconButton, Modal, Notice } from "@/shared/ui";
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

  const { jobs, acceptJob, queryError, hasMoreJobs, loadingMoreJobs, loadMoreJobs } = useJobData();
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
      acceptJob(await jobsApi.cancel(id));
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
        className="queue-drawer"
      >
        <div className="queue-drawer-body">
          {!jobs ? (
            <output>{queryError ?? t("generation.loadingTasks")}</output>
          ) : !jobs.length ? (
            <p className="generation-muted">{t("generation.noTasks")}</p>
          ) : (
            groups.map((group) => {
              const ordered = [...group].sort((a, b) => a.requestIndex - b.requestIndex);
              const active = ordered.filter(
                (job) => job.status === "queued" || job.status === "running",
              );
              return (
                <section className="queue-batch" key={ordered[0]!.batchId}>
                  <header>
                    <strong>{operationSummaryLabel(ordered[0]!.operation)}</strong>
                    <span>{t("generation.requestCount", { count: ordered[0]!.requestCount })}</span>
                    {active.length > 1 && (
                      <IconButton
                        label={t("generation.cancelBatchRequests")}
                        disabled={active.some((job) => pending.includes(job.id))}
                        onClick={() => {
                          for (const job of active) void cancel(job.id);
                        }}
                      >
                        <X size={15} />
                      </IconButton>
                    )}
                  </header>
                  <ol className="generation-job-list">
                    {ordered.map((job) => (
                      <li key={job.id} className={`generation-job generation-job-${job.status}`}>
                        <div className="generation-job-description">
                          <strong>
                            {job.requestIndex + 1}. {jobFeedbackText(job, feedback[job.id])}
                          </strong>
                          {job.operation.kind === "generation" && (
                            <span>
                              {t("generation.sampleCount", { count: job.operation.sampleCount })}
                            </span>
                          )}
                          {job.error && (
                            <span className="generation-danger">{errorMessage(job.error)}</span>
                          )}
                          <JobCostSummary
                            job={
                              jobObservations[job.id]
                                ? { ...job, observation: jobObservations[job.id]! }
                                : job
                            }
                          />
                        </div>
                        {onViewJob && job.operation.kind !== "encodeVibe" && (
                          <IconButton
                            label={t("generation.viewRequest")}
                            onClick={() => onViewJob(job.id)}
                          >
                            <Eye size={15} />
                          </IconButton>
                        )}
                        {(job.status === "queued" || job.status === "running") && (
                          <IconButton
                            label={t("generation.cancelRequest")}
                            disabled={pending.includes(job.id)}
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
                  </ol>
                </section>
              );
            })
          )}
          {hasMoreJobs && (
            <Button disabled={loadingMoreJobs} onClick={() => void loadMoreJobs()}>
              {loadingMoreJobs ? t("generation.loadingMore") : t("generation.loadEarlierTasks")}
            </Button>
          )}
          {error && <Notice>{error}</Notice>}
        </div>
        {retryJob && <JobRetryDialog job={retryJob} onClose={() => setRetryJob(null)} />}
      </Modal>
    </>
  );
}

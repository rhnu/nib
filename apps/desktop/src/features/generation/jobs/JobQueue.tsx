import { useFeedback } from "./feedback-context";
import { useJobData } from "./job-context";
import { jobsApi } from "./api";
import { useRef, useState } from "react";
import { ListOrdered, RotateCw, X } from "lucide-react";
import type { JobSummary } from "../../../bindings/generation";
import { Button, Notice } from "../../../shared/ui";
import { errorMessage } from "../../../shared/host/error";
import { JobRetryDialog } from "./JobRetryDialog";
import { operationSummaryLabel } from "./summary";
import { jobFeedbackText } from "./feedback-state";
import { JobCostSummary } from "./JobCostSummary";

export function JobQueue({ onViewJob }: { onViewJob?: (id: string) => void }) {
  const { jobs, acceptJob, queryError, hasMoreJobs, loadingMoreJobs, loadMoreJobs } = useJobData();
  const { feedback, jobObservations } = useFeedback();
  const [pending, setPending] = useState<string[]>([]);
  const pendingRef = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [retryJob, setRetryJob] = useState<JobSummary | null>(null);
  async function cancel(id: string) {
    if (pendingRef.current.has(id)) return;
    pendingRef.current.add(id);
    setPending([...pendingRef.current]);
    setError(null);
    try {
      acceptJob(await jobsApi.cancel(id));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      pendingRef.current.delete(id);
      setPending([...pendingRef.current]);
    }
  }
  const activeCount =
    jobs?.filter((job) => job.status === "queued" || job.status === "running").length ?? 0;
  return (
    <details className="generation-queue" aria-label="生成任务队列">
      <summary className="generation-section-heading">
        <h3>
          <ListOrdered size={15} />
          顺序任务
        </h3>
        <span className="generation-muted">
          {activeCount
            ? `${activeCount} 个待完成`
            : jobs === null
              ? "读取中"
              : `${jobs.length} 个任务`}
        </span>
      </summary>
      {jobs === null ? (
        <output className="generation-muted">
          {queryError ? "尚未读取任务，请重试查询。" : "正在读取任务…"}
        </output>
      ) : jobs.length === 0 ? (
        <p className="generation-muted">尚无任务</p>
      ) : (
        <ol className="generation-job-list">
          {jobs.map((job) => {
            const cancellable = job.status === "queued" || job.status === "running";
            const retryable =
              job.status === "failed" || job.status === "cancelled" || job.status === "interrupted";
            return (
              <li key={job.id} className={`generation-job generation-job-${job.status}`}>
                <div className="generation-job-description">
                  <strong>{jobFeedbackText(job, feedback[job.id])}</strong>
                  <time dateTime={new Date(job.submittedAt).toISOString()}>
                    {new Date(job.submittedAt).toLocaleString()}
                  </time>
                  <span>{operationSummaryLabel(job.operation)}</span>
                  <span>
                    任务 {job.id.slice(0, 8)}
                    {job.status === "completed" ? ` · ${job.resultIds.length} 个已保存结果` : ""}
                  </span>
                  {job.error && <span className="generation-danger">{job.error}</span>}
                  {job.status === "interrupted" && (
                    <small>应用中断后已停止，需手动再次提交。</small>
                  )}
                  <JobCostSummary
                    job={
                      jobObservations[job.id]
                        ? { ...job, observation: jobObservations[job.id]! }
                        : job
                    }
                  />
                </div>
                {onViewJob && (
                  <Button className="quiet" onClick={() => onViewJob(job.id)}>
                    查看
                  </Button>
                )}
                {cancellable && (
                  <Button
                    className="quiet"
                    title="请求取消；远程请求可能已经产生费用"
                    disabled={pending.includes(job.id)}
                    onClick={() => void cancel(job.id)}
                  >
                    <X size={13} />
                    {pending.includes(job.id) ? "正在取消…" : "取消"}
                  </Button>
                )}
                {retryable && (
                  <Button className="quiet" onClick={() => setRetryJob(job)}>
                    <RotateCw size={13} />
                    再次提交
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {hasMoreJobs && (
        <Button disabled={loadingMoreJobs} onClick={() => void loadMoreJobs()}>
          {loadingMoreJobs ? "正在读取…" : "读取更早任务"}
        </Button>
      )}
      {error && <Notice>{error}</Notice>}
      {retryJob && <JobRetryDialog job={retryJob} onClose={() => setRetryJob(null)} />}
    </details>
  );
}

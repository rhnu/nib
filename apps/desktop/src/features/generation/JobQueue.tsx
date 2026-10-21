import { useRef, useState } from "react";
import { ListOrdered, RotateCw, X } from "lucide-react";
import type { JobRecord } from "../../bindings/generation";
import { Button, Notice } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
import { generationApi } from "./api";
import { useGeneration } from "./generation-context";
import { JobRetryDialog } from "./JobRetryDialog";

const statusText: Record<JobRecord["status"], string> = {
  queued: "排队中",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

export function JobQueue() {
  const { jobs, acceptJob, queryError } = useGeneration();
  const [pending, setPending] = useState<string[]>([]);
  const pendingRef = useRef(new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [retryJob, setRetryJob] = useState<JobRecord | null>(null);
  async function cancel(id: string) {
    if (pendingRef.current.has(id)) return;
    pendingRef.current.add(id);
    setPending([...pendingRef.current]);
    setError(null);
    try {
      acceptJob(await generationApi.cancel(id));
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
                  <strong>{statusText[job.status]}</strong>
                  <time dateTime={new Date(job.submittedAt).toISOString()}>
                    {new Date(job.submittedAt).toLocaleString()}
                  </time>
                  <span>{job.submission.resolved.settings.model}</span>
                  {job.error && <span className="generation-danger">{job.error}</span>}
                  {job.status === "interrupted" && (
                    <small>应用中断后已停止，需手动再次提交。</small>
                  )}
                </div>
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
      {error && <Notice>{error}</Notice>}
      {retryJob && <JobRetryDialog job={retryJob} onClose={() => setRetryJob(null)} />}
    </details>
  );
}

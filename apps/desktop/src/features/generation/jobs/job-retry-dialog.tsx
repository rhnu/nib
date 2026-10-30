import { useMediaQuery } from "@/features/media/use-media-query";
import { useAccount } from "../account/account-context";
import { useJobData } from "./job-context";
import { jobsApi } from "./api";
import { useEffect, useRef, useState } from "react";
import type { JobRecord } from "@/bindings/generation";
import { Button, Modal, Notice } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { SubmissionSummary } from "../submission/submission-summary";

function JobRetryDialogContent({ job, onClose }: { job: JobRecord; onClose: () => void }) {
  const { account } = useAccount();
  const { acceptJob } = useJobData();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function retry() {
    if (lock.current || !account?.configured) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      acceptJob(await jobsApi.retry(job.id));
      if (active.current) onClose();
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="再次提交这个任务">
      <div className="generation-dialog-body">
        <p>使用原任务确定的请求内容和种子建立新任务。当前创作和后续资源修改不会改变这次提交。</p>
        <SubmissionSummary submission={job.submission} />
        <p className="generation-muted">
          再次提交会发起新的生成请求，可能再次扣除 Anlas。失败、中断或取消不代表之前未扣费。
        </p>
        {!account?.configured && <Notice>请先在设置中配置账户凭据。</Notice>}
        {error && <Notice>{error}</Notice>}
        <footer className="generation-dialog-actions">
          <Button onClick={onClose}>取消</Button>
          <Button
            className="primary"
            disabled={pending || !account?.configured}
            onClick={() => void retry()}
          >
            {pending ? "正在提交…" : "确认再次提交"}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

export function JobRetryDialog({
  job,
  onClose,
}: {
  job: Pick<JobRecord, "id">;
  onClose: () => void;
}) {
  const detail = useMediaQuery(["job", job.id], job.id, jobsApi.get, 0);
  if (detail.value) return <JobRetryDialogContent job={detail.value} onClose={onClose} />;
  return (
    <Modal open onClose={onClose} title="再次提交这个任务">
      <div className="generation-dialog-body">
        {detail.error ? (
          <Notice actions={<Button onClick={detail.retry}>重试读取</Button>}>{detail.error}</Notice>
        ) : (
          <output>正在读取原任务内容…</output>
        )}
      </div>
    </Modal>
  );
}

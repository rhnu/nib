import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useMediaQuery } from "@/features/media/use-media-query";
import { useAccount } from "../account/account-context";
import { useJobData } from "./job-context";
import { jobsApi } from "./api";
import { useEffect, useRef, useState } from "react";
import type { JobRecord } from "@/bindings/generation";
import { Button, Modal, Notice } from "@/shared/ui";
import { SubmissionSummary } from "../submission/submission-summary";

function JobRetryDialogContent({ job, onClose }: { job: JobRecord; onClose: () => void }) {
  useTranslation();

  const { account } = useAccount();
  const { acceptJob } = useJobData();
  const [pending, setPending] = useState(false);
  const [error, setError] = useMessageState();
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
      if (active.current) setError(cause);
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("generation.resubmitTitle")}>
      <div className="generation-dialog-body">
        <p>{t("generation.resubmitContentHelp")}</p>
        <SubmissionSummary submission={job.submission} />
        <p className="generation-muted">{t("generation.resubmitChargeWarning")}</p>
        {!account?.configured && <Notice>{t("generation.configureCredentialsHint")}</Notice>}
        {error && <Notice>{error}</Notice>}
        <footer className="generation-dialog-actions">
          <Button onClick={onClose}>{t("generation.cancel")}</Button>
          <Button
            className="primary"
            disabled={pending || !account?.configured}
            onClick={() => void retry()}
          >
            {pending ? t("generation.submitting") : t("generation.confirmResubmit")}
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
  useTranslation();

  const detail = useMediaQuery(["job", job.id], job.id, jobsApi.get, 0);
  if (detail.value) return <JobRetryDialogContent job={detail.value} onClose={onClose} />;
  return (
    <Modal open onClose={onClose} title={t("generation.resubmitTitle")}>
      <div className="generation-dialog-body">
        {detail.error ? (
          <Notice actions={<Button onClick={detail.retry}>{t("generation.retryLoad")}</Button>}>
            {detail.error}
          </Notice>
        ) : (
          <output>{t("generation.loadingOriginalTask")}</output>
        )}
      </div>
    </Modal>
  );
}

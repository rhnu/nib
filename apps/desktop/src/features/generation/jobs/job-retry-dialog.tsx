import { Button, Modal, Notice, Col, Toolbar } from "@/shared/ui";

import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useMediaQuery } from "@/features/media/use-media-query";
import { useAccount } from "../account/account-context";
import { useJobData } from "./job-context";
import { jobsApi } from "./api";
import { useEffect, useRef, useState } from "react";
import type { JobRecord } from "@/bindings/generation";

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
      <Col
        gap={0}
        align="stretch"
        className="generation-dialog-body flex flex-col gap-space-4 p-0 overflow-auto [&_button]:shrink-0 [&_p]:m-0"
      >
        <p>{t("generation.resubmitContentHelp")}</p>
        <SubmissionSummary submission={job.submission} />
        <p className="generation-muted text-muted">{t("generation.resubmitChargeWarning")}</p>
        {!account?.configured && <Notice>{t("generation.configureCredentialsHint")}</Notice>}
        {error && <Notice>{error}</Notice>}
        <Toolbar
          gap={2}
          as="footer"
          className="ui-actions flex items-center justify-end flex-wrap gap-space-3"
        >
          <Button onClick={onClose}>{t("generation.cancel")}</Button>
          <Button
            variant="primary"
            className=""
            disabled={pending || !account?.configured}
            onClick={() => void retry()}
          >
            {pending ? t("generation.submitting") : t("generation.confirmResubmit")}
          </Button>
        </Toolbar>
      </Col>
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
      <Col
        gap={0}
        align="stretch"
        className="generation-dialog-body flex flex-col gap-space-4 p-0 overflow-auto [&_button]:shrink-0 [&_p]:m-0"
      >
        {detail.error ? (
          <Notice actions={<Button onClick={detail.retry}>{t("generation.retryLoad")}</Button>}>
            {detail.error}
          </Notice>
        ) : (
          <output>{t("generation.loadingOriginalTask")}</output>
        )}
      </Col>
    </Modal>
  );
}

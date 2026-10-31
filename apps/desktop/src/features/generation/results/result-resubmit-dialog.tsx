import { t, useTranslation } from "@/shared/i18n";
import { useQuery } from "@tanstack/react-query";
import { resultsApi } from "./api";
import { useAccount } from "../account/account-context";
import { useJobData } from "../jobs/job-context";
import { useSubmission } from "../submission/submission-context";
import { submissionApi } from "../submission/api";
import { useEffect, useRef, useState } from "react";
import type { GenerationResult } from "@/bindings/generation";
import { Button, Modal, Notice } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { QuoteSummary } from "../submission/quote-summary";
import { SubmissionSummary } from "../submission/submission-summary";
import { TokenUsageSummary } from "../submission/token-usage-summary";
import { prepareResubmission } from "./result-resubmit-model";

export function ResultResubmitDialog({
  result,
  onClose,
}: {
  result: GenerationResult;
  onClose: () => void;
}) {
  useTranslation();

  const { account, accountVersion, accountSummaryLoading } = useAccount();
  const { acceptBatch } = useJobData();
  const { submit: submitGeneration, submissionBlocked } = useSubmission();
  const [submitError, setSubmitError] = useState<{ version: number; message: unknown } | null>(
    null,
  );
  const preview = useQuery({
    queryKey: ["results", "resubmit", result.id, result.submission.kind, accountVersion],
    queryFn: async () => {
      const restored = await resultsApi.restore(result.id);
      const draft = prepareResubmission(restored, result.submission.kind);
      return { draft, quote: await submissionApi.quote(draft) };
    },
    enabled: !accountSummaryLoading,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const prepared = accountSummaryLoading ? null : (preview.data ?? null);
  const error =
    submitError?.version === accountVersion
      ? errorMessage(submitError.message)
      : preview.error
        ? errorMessage(preview.error)
        : null;
  const [pending, setPending] = useState(false);
  const active = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function submit() {
    if (
      lock.current ||
      submissionBlocked ||
      !prepared ||
      prepared.quote.tooExpensive ||
      prepared.quote.tokens.some((token) => token.overLimit) ||
      !account?.configured ||
      accountSummaryLoading
    )
      return;
    lock.current = true;
    setPending(true);
    setSubmitError(null);
    try {
      acceptBatch(await submitGeneration(prepared.draft));
      if (active.current) onClose();
    } catch (cause) {
      if (active.current) setSubmitError({ version: accountVersion, message: cause });
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        result.submission.kind === "director"
          ? t("generation.processAgain")
          : t("generation.regenerateResultTitle")
      }
    >
      <div className="generation-dialog-body">
        <p>{t("generation.regenerateResultHelp")}</p>
        <SubmissionSummary submission={result.submission} />
        {prepared ? (
          <>
            <QuoteSummary quote={prepared.quote} />
            <TokenUsageSummary tokens={prepared.quote.tokens} />
          </>
        ) : (
          !error && <output>{t("generation.restoringAndEstimating")}</output>
        )}
        {!account?.configured && <Notice>{t("generation.configureCredentialsHint")}</Notice>}
        {error && (
          <Notice
            actions={
              !prepared && (
                <Button
                  onClick={() => {
                    setSubmitError(null);
                    void preview.refetch();
                  }}
                >
                  {t("generation.retryQuery")}
                </Button>
              )
            }
          >
            {error}
          </Notice>
        )}
        <footer className="ui-actions">
          <Button onClick={onClose}>{t("generation.cancel")}</Button>
          <Button
            className="primary"
            disabled={
              pending ||
              submissionBlocked ||
              !prepared ||
              prepared.quote.tooExpensive ||
              prepared.quote.tokens.some((token) => token.overLimit) ||
              !account?.configured ||
              accountSummaryLoading
            }
            onClick={() => void submit()}
          >
            {pending
              ? t("generation.submitting")
              : submissionBlocked
                ? t("generation.savingSettings")
                : result.submission.kind === "director"
                  ? t("generation.confirmProcess")
                  : t("generation.confirmGenerate")}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

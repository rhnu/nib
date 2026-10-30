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
  const { account, accountVersion, accountSummaryLoading } = useAccount();
  const { acceptBatch } = useJobData();
  const { submit: submitGeneration, submissionBlocked } = useSubmission();
  const [submitError, setSubmitError] = useState<{ version: number; message: string } | null>(null);
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
      ? submitError.message
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
      if (active.current) setSubmitError({ version: accountVersion, message: errorMessage(cause) });
    } finally {
      lock.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={result.submission.kind === "director" ? "再次处理" : "使用结果内容再次生成"}
    >
      <div className="generation-dialog-body">
        <p>用结果保存的内容、材料与有效设置创建新任务，不替换当前创作。</p>
        <SubmissionSummary submission={result.submission} />
        {prepared ? (
          <>
            <QuoteSummary quote={prepared.quote} />
            <TokenUsageSummary tokens={prepared.quote.tokens} />
          </>
        ) : (
          !error && <output>正在恢复内容并通过 SDK 估算费用…</output>
        )}
        {!account?.configured && <Notice>请先在设置中配置账户凭据。</Notice>}
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
                  重试查询
                </Button>
              )
            }
          >
            {error}
          </Notice>
        )}
        <footer className="generation-dialog-actions">
          <Button onClick={onClose}>取消</Button>
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
              ? "正在提交…"
              : submissionBlocked
                ? "正在保存设置…"
                : result.submission.kind === "director"
                  ? "确认处理"
                  : "确认生成"}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

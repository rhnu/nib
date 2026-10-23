import { useEffect, useRef, useState } from "react";
import type { Draft } from "../../bindings/workbench";
import type { GenerationQuote, GenerationResult } from "../../bindings/generation";
import { Button, Modal, Notice } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
import { generationApi } from "./api";
import { useGeneration } from "./generation-context";
import { QuoteSummary } from "./QuoteSummary";
import { SubmissionSummary } from "./SubmissionSummary";
import { TokenUsageSummary } from "./TokenUsageSummary";
import { prepareResubmission } from "./result-resubmit-model";

export function ResultResubmitDialog({
  result,
  onClose,
}: {
  result: GenerationResult;
  onClose: () => void;
}) {
  const {
    account,
    acceptJob,
    accountVersion,
    accountSummaryLoading,
    submit: submitGeneration,
    submissionBlocked,
  } = useGeneration();
  const [response, setPrepared] = useState<{
    draft: Draft;
    quote: GenerationQuote;
    version: number;
  } | null>(null);
  const prepared = response?.version === accountVersion ? response : null;
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const active = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void generationApi
      .restore(result.id)
      .then(async (restored) => {
        if (cancelled) return null;
        const draft = prepareResubmission(restored, result.submission.kind);
        return { draft, quote: await generationApi.quote(draft) };
      })
      .then(
        (value) => {
          if (!cancelled && value) {
            setPrepared({ ...value, version: accountVersion });
            setError(null);
          }
        },
        (cause: unknown) => {
          if (!cancelled) setError(errorMessage(cause));
        },
      );
    return () => {
      cancelled = true;
    };
  }, [result.id, result.submission.kind, attempt, accountVersion]);
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
    setError(null);
    try {
      acceptJob(await submitGeneration(prepared.draft));
      if (active.current) onClose();
    } catch (cause) {
      if (active.current) setError(errorMessage(cause));
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
                    setError(null);
                    setAttempt((value) => value + 1);
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

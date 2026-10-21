import { useRef, useState } from "react";
import { KeyRound, Play, RotateCw } from "lucide-react";
import type { Draft } from "../../bindings/workbench";
import { Button } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
import { AccountDialog } from "./AccountDialog";
import { generationApi } from "./api";
import { useGeneration } from "./GenerationProvider";
import { QuoteSummary } from "./QuoteSummary";
import { draftContentKey, useGenerationQuote } from "./use-generation-quote";

export function GenerationActions({
  draft,
  readCurrentDraft,
  refreshKey,
}: {
  draft: Draft;
  readCurrentDraft: () => Draft;
  refreshKey?: unknown;
}) {
  const { account, accountLoading, accountError, refreshAccount, acceptJob } = useGeneration();
  const estimate = useGenerationQuote(draft, refreshKey);
  const [accountOpen, setAccountOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const submittingRef = useRef(false);

  async function submit() {
    if (
      submittingRef.current ||
      !account?.configured ||
      !estimate.quote ||
      estimate.quote.tooExpensive
    )
      return;
    const snapshot = structuredClone(readCurrentDraft());
    if (draftContentKey(snapshot) !== estimate.key) {
      setSubmitError("当前创作已改变，请等待费用重新估算后提交。");
      estimate.retry();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitted(false);
    try {
      acceptJob(await generationApi.submit(snapshot));
      setSubmitted(true);
    } catch (cause) {
      setSubmitError(errorMessage(cause));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const error = submitError ?? accountError ?? estimate.error;
  return (
    <div className="generation-actions">
      <Button onClick={() => setAccountOpen(true)}>
        <KeyRound size={14} />
        {account?.configured ? "账户已配置" : "配置账户"}
      </Button>
      <div className="generation-quote" aria-live="polite">
        {estimate.loading ? (
          <span className="generation-muted">正在估算费用…</span>
        ) : estimate.quote ? (
          <QuoteSummary quote={estimate.quote} />
        ) : (
          <span className="generation-muted">费用暂不可用</span>
        )}
        {!accountLoading && account && !account.configured && <small>请先配置 API Key</small>}
      </div>
      <Button
        className="primary"
        disabled={
          submitting ||
          accountLoading ||
          !account?.configured ||
          !estimate.quote ||
          estimate.quote.tooExpensive
        }
        onClick={() => void submit()}
      >
        <Play size={14} />
        {submitting ? "正在提交…" : "生成"}
      </Button>
      {submitted && <output className="generation-muted">已加入顺序队列</output>}
      {error && (
        <div className="generation-action-error" role="alert">
          <span>{error}</span>
          <Button
            className="quiet"
            onClick={() => {
              setSubmitError(null);
              setSubmitted(false);
              estimate.retry();
              void refreshAccount();
            }}
          >
            <RotateCw size={13} />
            重试查询
          </Button>
        </div>
      )}
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
    </div>
  );
}

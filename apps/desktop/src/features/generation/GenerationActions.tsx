import { useEffect, useRef, useState } from "react";
import { KeyRound, Play, RotateCw } from "lucide-react";
import type { Draft, ResolvedDraft } from "../../bindings/workbench";
import { Button } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
import { AccountDialog } from "./AccountDialog";
import { generationApi } from "./api";
import { useGeneration } from "./generation-context";
import { QuoteHelp } from "./QuoteSummary";
import { useGenerationQuote } from "./use-generation-quote";
import { generationQuoteKey, isQuoteEligible } from "./quote-state";
import { ParameterDiagnostics } from "./ParameterDiagnostics";

export function GenerationActions({
  draft,
  readCurrentDraft,
  refreshKey,
  resolved,
  resolving = false,
}: {
  draft: Draft;
  readCurrentDraft: () => Draft;
  refreshKey?: unknown;
  resolved?: ResolvedDraft | null;
  resolving?: boolean;
}) {
  const { account, accountLoading, accountError, refreshAccount, acceptJob } = useGeneration();
  const hasPrompt = isQuoteEligible(draft, resolved);
  const estimate = useGenerationQuote(draft, refreshKey, !resolving && hasPrompt);
  const [accountOpen, setAccountOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ key: string; message: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const submittingRef = useRef(false);
  if (submitError && (!hasPrompt || submitError.key !== estimate.key)) setSubmitError(null);
  useEffect(() => {
    if (!submitted) return;
    const timer = setTimeout(() => setSubmitted(false), 3000);
    return () => clearTimeout(timer);
  }, [submitted]);

  async function submit() {
    if (
      submittingRef.current ||
      !account?.configured ||
      !estimate.quote ||
      estimate.quote.tooExpensive
    )
      return;
    const snapshot = structuredClone(readCurrentDraft());
    if (generationQuoteKey(snapshot, refreshKey) !== estimate.key) {
      setSubmitError({ key: estimate.key, message: "当前创作已改变，请等待费用重新估算后提交。" });
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
      setSubmitError({ key: estimate.key, message: errorMessage(cause) });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const currentSubmitError =
    hasPrompt && submitError?.key === estimate.key ? submitError.message : null;
  const error = currentSubmitError ?? accountError ?? estimate.error;
  return (
    <div className="generation-actions">
      <div className="generation-submit-row">
        <Button
          className="primary"
          disabled={
            submitting ||
            accountLoading ||
            (Boolean(account?.configured) && (!estimate.quote || estimate.quote.tooExpensive))
          }
          onClick={() => {
            if (!account?.configured) setAccountOpen(true);
            else void submit();
          }}
        >
          <span className="generation-submit-label">
            {account?.configured ? <Play size={14} /> : <KeyRound size={14} />}
            {submitting
              ? "正在提交…"
              : accountLoading
                ? "读取账户…"
                : account?.configured
                  ? "生成"
                  : "配置账户以生成"}
          </span>
          {estimate.quote ? (
            <span className="generation-submit-cost">
              {estimate.quote.estimatedAnlas === null
                ? "费用未知"
                : `${estimate.quote.estimatedAnlas} Anlas`}
            </span>
          ) : estimate.loading ? (
            <span className="generation-submit-cost">估算中…</span>
          ) : null}
        </Button>
        <QuoteHelp />
      </div>
      {estimate.quote?.tooExpensive && <span className="generation-danger">超出费用限制</span>}
      {estimate.quote && <ParameterDiagnostics diagnostics={estimate.quote.diagnostics} />}
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

import { useEffect, useRef, useState } from "react";
import { KeyRound, Play, RotateCw } from "lucide-react";
import type { Draft, ResolvedDraft } from "../../bindings/workbench";
import { Button } from "../../shared/ui";
import { errorMessage } from "../../shared/host/error";
import { hasPendingWork } from "../../shared/host/pending-work";
import { AccountDialog } from "./AccountDialog";
import { generationApi } from "./api";
import { useGeneration } from "./generation-context";
import { QuoteHelp } from "./QuoteSummary";
import { useGenerationQuote, validationFields } from "./use-generation-quote";
import { generationQuoteKey, isQuoteEligible, isOperationEffective } from "./quote-state";
import { ParameterDiagnostics } from "./ParameterDiagnostics";
import { AccountSnapshot } from "./AccountSnapshot";
import { focusSetting } from "../prompt/SettingsEditor";
import { operationLabel } from "../workbench/image-operation";

export function GenerationActions({
  draft,
  readCurrentDraft,
  refreshKey,
  resolved,
  estimate,
  operationPending,
  onFocusField = focusSetting,
}: {
  draft: Draft;
  readCurrentDraft: () => Draft;
  refreshKey?: unknown;
  resolved?: ResolvedDraft | null;
  estimate: ReturnType<typeof useGenerationQuote>;
  operationPending: boolean;
  onFocusField?: (field: string) => void;
}) {
  const {
    account,
    accountLoading,
    accountError,
    refreshAccount,
    acceptJob,
    accountSummaryLoading,
  } = useGeneration();
  const hasPrompt = isQuoteEligible(draft, resolved);
  const effectiveOperation = isOperationEffective(
    draft.inputs.operation,
    estimate.quote?.resolved?.inputs.operation ?? null,
  );
  const actionLabel =
    draft.inputs.operation.kind === "textToImage" ? "生成" : operationLabel(draft.inputs.operation);
  const [accountOpen, setAccountOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ key: string; message: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitFields, setSubmitFields] = useState<string[]>([]);
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
      hasPendingWork() ||
      operationPending ||
      !effectiveOperation ||
      !account?.configured ||
      !estimate.quote ||
      estimate.quote.tooExpensive ||
      estimate.quote.tokens.some((token) => token.overLimit) ||
      accountSummaryLoading
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
      setSubmitFields(validationFields(cause));
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
            operationPending ||
            (Boolean(estimate.quote) && !effectiveOperation) ||
            accountLoading ||
            accountSummaryLoading ||
            (Boolean(account?.configured) &&
              (!estimate.quote ||
                estimate.quote.tooExpensive ||
                estimate.quote.tokens.some((token) => token.overLimit)))
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
                  ? actionLabel
                  : "配置账户"}
          </span>
          {estimate.quote && !effectiveOperation ? (
            <span className="generation-submit-cost">操作未生效</span>
          ) : estimate.quote ? (
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
      <AccountSnapshot compact />
      {estimate.quote && !effectiveOperation && (
        <p className="generation-danger" role="alert">
          {draft.inputs.operation.kind === "inpainting"
            ? "局部重绘或所选局部条件未生效。请选择纯补绘或更换模型后再提交。"
            : "SDK 未保留 Max Enhance 操作。请切换支持的模型，或明确选择普通图生图后再提交。"}
        </p>
      )}
      {estimate.quote?.tooExpensive && <span className="generation-danger">超出费用限制</span>}
      {estimate.quote && (
        <ParameterDiagnostics diagnostics={estimate.quote.diagnostics} onLocate={onFocusField} />
      )}
      {submitted && <output className="generation-muted">已加入顺序队列</output>}
      {error && (
        <div className="generation-action-error" role="alert">
          <span>{error}</span>
          {(currentSubmitError ? submitFields : estimate.fields).map((field) => (
            <Button key={field} className="quiet" onClick={() => onFocusField(field)}>
              定位参数
            </Button>
          ))}
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

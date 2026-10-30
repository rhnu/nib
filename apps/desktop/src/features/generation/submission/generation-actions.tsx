import { t, useTranslation, deferMessage } from "@/shared/i18n";
import { useAccount } from "../account/account-context";
import { useJobData } from "../jobs/job-context";
import { useSubmission } from "./submission-context";
import { useEffect, useRef, useState } from "react";
import { KeyRound, Play, RotateCw } from "lucide-react";
import type { Draft, ResolvedDraft } from "@/bindings/workbench";
import { Button } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { hasPendingWork } from "@/shared/host/pending-work";
import { AccountDialog } from "../account/account-dialog";
import { useGenerationQuote, validationFields } from "./use-generation-quote";
import { generationQuoteKey, isQuoteEligible, isOperationEffective } from "./quote-state";
import { ParameterDiagnostics } from "./parameter-diagnostics";
import { AccountSnapshot } from "../account/account-snapshot";
import { focusSetting } from "@/features/prompt/settings-editor";
import { operationLabel } from "@/features/inputs/image-operation";

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
  useTranslation();

  const { account, accountLoading, accountError, refreshAccount, accountSummaryLoading } =
    useAccount();
  const { acceptBatch } = useJobData();
  const { submit: submitGeneration, submissionBlocked } = useSubmission();
  const hasPrompt = isQuoteEligible(draft, resolved);
  const effectiveOperation = isOperationEffective(
    draft.inputs.operation,
    estimate.quote?.resolved?.inputs.operation ?? null,
  );
  const actionLabel =
    draft.inputs.operation.kind === "textToImage"
      ? t("generation.generate")
      : operationLabel(draft.inputs.operation);
  const [accountOpen, setAccountOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ key: string; message: unknown } | null>(null);
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
      submissionBlocked ||
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
      setSubmitError({
        key: estimate.key,
        message: deferMessage(() => t("generation.creationChanged")),
      });
      estimate.retry();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitted(false);
    try {
      acceptBatch(await submitGeneration(snapshot), true);
      setSubmitted(true);
    } catch (cause) {
      setSubmitError({ key: estimate.key, message: cause });
      setSubmitFields(validationFields(cause));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const currentSubmitError =
    hasPrompt && submitError?.key === estimate.key ? errorMessage(submitError.message) : null;
  const error = currentSubmitError ?? accountError ?? estimate.error;
  return (
    <div className="generation-actions">
      <div className="generation-submit-row">
        <Button
          className="primary"
          disabled={
            submitting ||
            submissionBlocked ||
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
              ? t("generation.submitting")
              : submissionBlocked
                ? t("generation.savingSettings")
                : accountLoading
                  ? t("generation.loadingAccount")
                  : account?.configured
                    ? actionLabel
                    : t("generation.configureAccount")}
            {account?.configured &&
              estimate.quote?.operation === "generation" &&
              estimate.quote.requestCount > 1 && (
                <small>
                  {t("generation.requestBatchSize", {
                    requests: estimate.quote.requestCount,
                    samples: estimate.quote.totalSamples / estimate.quote.requestCount,
                  })}
                </small>
              )}
          </span>
          {estimate.quote && !effectiveOperation ? (
            <span className="generation-submit-cost">{t("generation.operationNotApplied")}</span>
          ) : estimate.quote ? (
            <span className="generation-submit-cost">
              {estimate.quote.estimatedAnlas === null
                ? t("generation.costUnknown")
                : `${estimate.quote.estimatedAnlas} Anlas`}
            </span>
          ) : estimate.loading ? (
            <span className="generation-submit-cost">{t("generation.estimating")}</span>
          ) : null}
        </Button>
      </div>
      <AccountSnapshot compact />
      {estimate.quote && !effectiveOperation && (
        <p className="generation-danger" role="alert">
          {draft.inputs.operation.kind === "inpainting"
            ? t("generation.inpaintNotApplied")
            : t("generation.maxEnhanceNotApplied")}
        </p>
      )}
      {estimate.quote?.tooExpensive && (
        <span className="generation-danger">{t("generation.costLimitExceeded")}</span>
      )}
      {estimate.quote && (
        <ParameterDiagnostics diagnostics={estimate.quote.diagnostics} onLocate={onFocusField} />
      )}
      {submitted && <output className="generation-muted">{t("generation.addedToQueue")}</output>}
      {error && (
        <div className="generation-action-error" role="alert">
          <span>{error}</span>
          {(currentSubmitError ? submitFields : estimate.fields).map((field) => (
            <Button key={field} className="quiet" onClick={() => onFocusField(field)}>
              {t("generation.locateParameter")}
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
            {t("generation.retryQuery")}
          </Button>
        </div>
      )}
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
    </div>
  );
}

import { t, useTranslation, deferMessage } from "@/shared/i18n";
import { useAccount } from "../account/account-context";
import { useJobData } from "../jobs/job-context";
import { useSubmission } from "./submission-context";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { KeyRound, WandSparkles, RotateCw } from "lucide-react";
import type { Draft } from "@/bindings/workbench";
import { Button } from "@/shared/ui";
import { errorMessage } from "@/shared/host/error";
import { hasPendingWork } from "@/shared/host/pending-work";
import { AccountDialog } from "../account/account-dialog";
import { useGenerationQuote, validationFields } from "./use-generation-quote";
import { generationQuoteKey, isOperationEffective } from "./quote-state";
import { ParameterDiagnostics } from "./parameter-diagnostics";
import { AccountSnapshot } from "../account/account-snapshot";
import { focusSetting } from "@/features/prompt/settings-editor";
import { operationLabel } from "@/features/inputs/image-operation";

export function GenerationActions({
  draft,
  readCurrentDraft,
  refreshKey,
  parameters,
  estimate,
  operationPending,
  onFocusField = focusSetting,
}: {
  draft: Draft;
  readCurrentDraft: () => Draft;
  refreshKey?: unknown;
  parameters?: ReactNode;
  estimate: ReturnType<typeof useGenerationQuote>;
  operationPending: boolean;
  onFocusField?: (field: string) => void;
}) {
  useTranslation();

  const {
    account,
    accountLoading,
    accountError,
    refreshAccount,
    accountSummaryLoading,
    accountSummaryError,
    refreshAccountSummary,
  } = useAccount();
  const { acceptBatch } = useJobData();
  const { submit: submitGeneration, submissionBlocked } = useSubmission();
  const effectiveOperation = isOperationEffective(
    draft.inputs.operation,
    estimate.quote?.resolved?.inputs.operation ?? null,
  );
  const actionLabel =
    draft.inputs.operation.kind === "textToImage"
      ? estimate.quote
        ? t("generation.generateImages", { count: estimate.quote.totalSamples })
        : t("generation.generate")
      : operationLabel(draft.inputs.operation);
  const [accountOpen, setAccountOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ key: string; message: unknown } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitFields, setSubmitFields] = useState<string[]>([]);
  const submittingRef = useRef(false);
  if (submitError && submitError.key !== estimate.key) setSubmitError(null);
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
    submitError?.key === estimate.key ? errorMessage(submitError.message) : null;
  const error = currentSubmitError ?? accountError ?? accountSummaryError ?? estimate.error;
  return (
    <div className="generation-actions">
      <AccountSnapshot compact />
      {parameters}
      <div className="generation-submit-row">
        <Button
          className="primary"
          disabled={
            accountLoading ||
            submitting ||
            (Boolean(account?.configured) &&
              (submissionBlocked ||
                operationPending ||
                accountSummaryLoading ||
                !effectiveOperation ||
                !estimate.quote ||
                estimate.quote.tooExpensive ||
                estimate.quote.tokens.some((token) => token.overLimit)))
          }
          onClick={() => {
            if (!account?.configured) setAccountOpen(true);
            else void submit();
          }}
        >
          <span className="generation-submit-label">
            {account?.configured ? (
              <WandSparkles size={16} aria-hidden />
            ) : (
              <KeyRound size={14} aria-hidden />
            )}
            {submitting
              ? t("generation.submitting")
              : accountLoading
                ? t("generation.loadingAccount")
                : !account?.configured
                  ? t("generation.configureAccount")
                  : submissionBlocked
                    ? t("generation.savingSettings")
                    : actionLabel}
          </span>
          {account?.configured &&
            (estimate.quote && !effectiveOperation ? (
              <span className="generation-submit-cost">{t("generation.operationNotApplied")}</span>
            ) : estimate.quote ? (
              <span className="generation-submit-cost">
                {estimate.quote.estimatedAnlas === null
                  ? t("generation.costUnknown")
                  : `${estimate.quote.estimatedAnlas} Anlas`}
              </span>
            ) : estimate.loading ? (
              <span className="generation-submit-cost">{t("generation.estimating")}</span>
            ) : (
              <span className="generation-submit-cost">{t("generation.costUnknown")}</span>
            ))}
        </Button>
      </div>
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
              void refreshAccountSummary();
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

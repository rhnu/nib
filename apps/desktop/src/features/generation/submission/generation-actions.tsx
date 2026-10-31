import { t, useTranslation, deferMessage } from "@/shared/i18n";
import { useAccount } from "../account/account-context";
import { originForOperation } from "./work-state";
import { useSubmission } from "./submission-context";
import { useRef, useState, type ReactNode } from "react";
import { AlertCircle, KeyRound, WandSparkles, RotateCw } from "lucide-react";
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
  const { submit: submitGeneration, submissionBlocked, work } = useSubmission();
  const working = work[originForOperation(draft.inputs.operation.kind)];
  const displayQuote = estimate.displayQuote;
  const effectiveOperation = isOperationEffective(
    draft.inputs.operation,
    estimate.quote?.resolved?.inputs.operation ?? null,
  );
  const actionLabel =
    draft.inputs.operation.kind === "textToImage"
      ? displayQuote
        ? t("generation.generateImages", { count: displayQuote.totalSamples })
        : t("generation.generate")
      : operationLabel(draft.inputs.operation);
  const [accountOpen, setAccountOpen] = useState(false);
  const [submitError, setSubmitError] = useState<{ key: string; message: unknown } | null>(null);
  const [submitFields, setSubmitFields] = useState<string[]>([]);
  const submittingRef = useRef(false);
  if (submitError && submitError.key !== estimate.key) setSubmitError(null);

  async function submit() {
    if (
      submittingRef.current ||
      working !== "idle" ||
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
    setSubmitError(null);
    try {
      await submitGeneration(snapshot);
    } catch (cause) {
      setSubmitError({ key: estimate.key, message: cause });
      setSubmitFields(validationFields(cause));
    } finally {
      submittingRef.current = false;
    }
  }

  const currentSubmitError =
    submitError?.key === estimate.key ? errorMessage(submitError.message) : null;
  const error = currentSubmitError ?? accountError ?? accountSummaryError ?? estimate.error;
  const actionError =
    working === "idle" && !accountLoading
      ? (error ??
        (estimate.quote && !effectiveOperation
          ? draft.inputs.operation.kind === "inpainting"
            ? t("generation.inpaintNotApplied")
            : t("generation.maxEnhanceNotApplied")
          : estimate.quote?.tooExpensive
            ? t("generation.costLimitExceeded")
            : null))
      : null;
  return (
    <div className="generation-actions">
      <AccountSnapshot compact />
      {parameters}
      <div className="generation-submit-row">
        <Button
          className="primary"
          data-error={actionError ? "" : undefined}
          title={actionError ?? undefined}
          aria-busy={working !== "idle"}
          disabled={
            accountLoading ||
            working !== "idle" ||
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
          {actionError ? (
            <span className="generation-submit-error" role="alert">
              <AlertCircle size={16} aria-hidden />
              <span>{actionError}</span>
            </span>
          ) : (
            <span className="generation-submit-label">
              {account?.configured ? (
                <WandSparkles size={16} aria-hidden />
              ) : (
                <KeyRound size={14} aria-hidden />
              )}
              {working === "loading"
                ? t("generation.loading")
                : working === "running"
                  ? t("generation.working")
                  : working === "queued"
                    ? t("generation.queued")
                    : working === "submitting"
                      ? t("generation.submitting")
                      : accountLoading
                        ? t("generation.loadingAccount")
                        : !account?.configured
                          ? t("generation.configureAccount")
                          : submissionBlocked
                            ? t("generation.savingSettings")
                            : actionLabel}
            </span>
          )}
          {!actionError &&
            account?.configured &&
            (estimate.quote && !effectiveOperation ? (
              <span className="generation-submit-cost">{t("generation.operationNotApplied")}</span>
            ) : displayQuote ? (
              <span
                className="generation-submit-cost"
                aria-busy={estimate.refreshing}
                title={estimate.refreshing ? t("generation.estimating") : undefined}
              >
                {displayQuote.estimatedAnlas === null
                  ? t("generation.costUnknown")
                  : `${displayQuote.estimatedAnlas} Anlas`}
              </span>
            ) : estimate.loading ? (
              <span className="generation-submit-cost">{t("generation.estimating")}</span>
            ) : (
              <span className="generation-submit-cost">{t("generation.costUnknown")}</span>
            ))}
        </Button>
      </div>
      {estimate.quote && (
        <ParameterDiagnostics diagnostics={estimate.quote.diagnostics} onLocate={onFocusField} />
      )}
      {actionError && error && (
        <div className="generation-action-error">
          {(currentSubmitError ? submitFields : estimate.fields).map((field) => (
            <Button key={field} className="quiet" onClick={() => onFocusField(field)}>
              {t("generation.locateParameter")}
            </Button>
          ))}
          <Button
            className="quiet"
            onClick={() => {
              setSubmitError(null);
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

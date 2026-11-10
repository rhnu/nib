import { Button, IconButton, Notice, Col, Row } from "@/shared/ui";

import { t, useTranslation, deferMessage } from "@/shared/i18n";
import { useAccount } from "../account/account-context";
import { originForOperation, workBatch } from "./work-state";
import { useSubmission } from "./submission-context";
import { useRef, useState, type ReactNode } from "react";
import { AlertCircle, KeyRound, WandSparkles, RotateCw, Square } from "lucide-react";
import type { Draft } from "@/bindings/workbench";

import { useJobData } from "../jobs/job-context";
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
  const { jobs, stopBatch, stoppingBatches } = useJobData();
  const batch = workBatch(jobs, originForOperation(draft.inputs.operation.kind));
  const [stopError, setStopError] = useState<unknown>(null);
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
    setStopError(null);
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
    <Col
      gap={0}
      align="stretch"
      className="generation-actions flex flex-col gap-space-2 [&:has(.generation-parameter-panel[data-open])_>_.generation-account-balance]:hidden [&_button]:shrink-0"
    >
      <AccountSnapshot compact />
      {parameters}
      <Row
        gap={0}
        className="generation-submit-row [&_>_[data-variant=primary]]:flex-1 [&_>_[data-variant=primary]]:w-full [&_>_[data-variant=primary]]:min-w-0 [&_>_[data-variant=primary]]:min-h-control-prominent [&_>_[data-variant=primary]]:justify-between flex items-center gap-[10px] min-w-0"
      >
        {actionError ? (
          <Row
            gap={0}
            className="generation-error-banner [&_>_svg]:shrink-0 [&_>_span]:[flex:1_1_180px] [&_>_span]:min-w-0 flex flex-1 flex-wrap items-center gap-space-2 min-w-0 py-space-2 px-space-3 text-danger border border-danger rounded-control bg-background whitespace-normal wrap-anywhere text-left"
            role="alert"
          >
            <AlertCircle size={16} aria-hidden />
            <span>{actionError}</span>
            {error && (
              <Row
                gap={0}
                align="stretch"
                className="generation-error-actions [&_>_button]:text-inherit flex flex-wrap gap-space-1 ml-auto"
              >
                {!account?.configured && (
                  <Button variant="quiet" className="" onClick={() => setAccountOpen(true)}>
                    <KeyRound size={13} aria-hidden />
                    {t("generation.configureAccount")}
                  </Button>
                )}
                {[...new Set(currentSubmitError ? submitFields : estimate.fields)].map((field) => (
                  <Button
                    variant="quiet"
                    key={field}
                    className=""
                    onClick={() => onFocusField(field)}
                  >
                    {t("generation.locateParameter")}
                  </Button>
                ))}
                <Button
                  variant="quiet"
                  className=""
                  onClick={() => {
                    setSubmitError(null);
                    estimate.retry();
                    void refreshAccount();
                    void refreshAccountSummary();
                  }}
                >
                  <RotateCw size={13} aria-hidden />
                  {t("generation.retryQuery")}
                </Button>
              </Row>
            )}
          </Row>
        ) : (
          <Button
            variant="primary"
            className=""
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
            <Row
              gap={0}
              as="span"
              className="generation-submit-label [&_>_svg]:shrink-0 inline-flex items-center gap-space-2 min-w-0 whitespace-normal text-left"
            >
              {account?.configured ? (
                <WandSparkles size={16} aria-hidden />
              ) : (
                <KeyRound size={14} aria-hidden />
              )}
              {working === "loading"
                ? t("generation.loading")
                : working === "running"
                  ? batch?.finishing
                    ? t("generation.waitingForCurrentRequest")
                    : batch?.running
                      ? t("generation.requestProgress", {
                          index: batch.running.requestIndex + 1,
                          total: batch.requestCount,
                        })
                      : t("generation.working")
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
            </Row>
            {account?.configured &&
              (estimate.quote && !effectiveOperation ? (
                <span className="generation-submit-cost [&[aria-busy=true]]:opacity-[0.65] py-[2px] px-space-2 border border-current rounded-control text-caption tabular-nums">
                  {t("generation.operationNotApplied")}
                </span>
              ) : displayQuote ? (
                <span
                  className="generation-submit-cost [&[aria-busy=true]]:opacity-[0.65] py-[2px] px-space-2 border border-current rounded-control text-caption tabular-nums"
                  aria-busy={estimate.refreshing}
                  title={estimate.refreshing ? t("generation.estimating") : undefined}
                >
                  {displayQuote.estimatedAnlas === null
                    ? t("generation.costUnknown")
                    : `${displayQuote.estimatedAnlas} Anlas`}
                </span>
              ) : estimate.loading ? (
                <span className="generation-submit-cost [&[aria-busy=true]]:opacity-[0.65] py-[2px] px-space-2 border border-current rounded-control text-caption tabular-nums">
                  {t("generation.estimating")}
                </span>
              ) : (
                <span className="generation-submit-cost [&[aria-busy=true]]:opacity-[0.65] py-[2px] px-space-2 border border-current rounded-control text-caption tabular-nums">
                  {t("generation.costUnknown")}
                </span>
              ))}
          </Button>
        )}
        {working !== "submitting" && batch && batch.queued > 0 && (
          <IconButton
            label={
              batch.running
                ? t("generation.stopRemainingRequests")
                : t("generation.cancelQueuedRequests")
            }
            title={t("generation.stopRequestsHelp")}
            disabled={stoppingBatches.includes(batch.id)}
            aria-busy={stoppingBatches.includes(batch.id)}
            onClick={() => {
              setStopError(null);
              void stopBatch(batch.id).catch(setStopError);
            }}
          >
            <Square size={15} fill="currentColor" />
          </IconButton>
        )}
      </Row>
      {stopError !== null && <Notice>{errorMessage(stopError)}</Notice>}
      {estimate.quote && (
        <ParameterDiagnostics diagnostics={estimate.quote.diagnostics} onLocate={onFocusField} />
      )}
      {accountOpen && <AccountDialog onClose={() => setAccountOpen(false)} />}
    </Col>
  );
}

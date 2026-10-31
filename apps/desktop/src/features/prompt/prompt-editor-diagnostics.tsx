import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { LoaderCircle, TriangleAlert, WholeWord } from "lucide-react";
import { t } from "@/shared/i18n";
import { sourceDiagnosticMessage } from "./editor-diagnostics";
import type { PromptEditorStatistics } from "./use-prompt-editor-statistics";

type LocationHandler = (from: number, to: number) => void;

/** Statistics and diagnostics share a single keyboard-accessible indicator. */
export function PromptEditorDiagnostics({
  statistics,
  details,
  label,
  disabled,
  onLocate,
}: {
  statistics: PromptEditorStatistics;
  details: string[];
  label: string;
  disabled: boolean;
  onLocate: LocationHandler;
}) {
  const [open, setOpen] = useState(false);
  const {
    status,
    pending,
    loadingIndicator,
    hasIssue,
    diagnostics,
    analysisError,
    tokenError,
    retryAnalysis,
    retryCount,
  } = statistics;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        className={`prompt-editor-action prompt-token-indicator icon-button${hasIssue ? " danger" : ""}`}
        disabled={disabled}
        aria-busy={pending}
        aria-label={`${label} · ${status}${diagnostics.length ? ` · ${t("prompt.diagnosticCount", { count: diagnostics.length })}` : ""}`}
        openOnHover
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
      >
        {hasIssue ? (
          <TriangleAlert size={13} aria-hidden />
        ) : loadingIndicator ? (
          <LoaderCircle size={13} className="spin" aria-hidden />
        ) : (
          <WholeWord size={13} aria-hidden />
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={5} className="help-positioner">
          <Popover.Popup className="prompt-token-popup" initialFocus={false}>
            <Popover.Description>{status}</Popover.Description>
            {details.length > 0 && <p className="prompt-selection-detail">{details.join(" · ")}</p>}
            {diagnostics.length > 0 && (
              <ul className="prompt-diagnostic-list" aria-label={t("prompt.syntaxDiagnostics")}>
                {diagnostics.map((item, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onLocate(item.from, item.to);
                      }}
                    >
                      <TriangleAlert size={12} aria-hidden />
                      {item.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(analysisError || tokenError) && (
              <button type="button" onClick={analysisError ? retryAnalysis : retryCount}>
                {t("prompt.retry")}
              </button>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Source failures remain visible when the editor is collapsed. */
export function PromptEditorErrors({
  statistics,
  insertionError,
  onLocate,
}: {
  statistics: PromptEditorStatistics;
  insertionError: string;
  onLocate: LocationHandler;
}) {
  return (
    <>
      {insertionError && (
        <div className="prompt-analysis-error" role="alert">
          <TriangleAlert size={12} aria-hidden />
          <span>{t("lexicon.insertionFailed", { detail: insertionError })}</span>
        </div>
      )}
      {statistics.document?.sourceDiagnostics.map((diagnostic, index) => (
        <div key={index} className="prompt-analysis-error" role="alert">
          <TriangleAlert size={12} aria-hidden />
          <span>{sourceDiagnosticMessage(diagnostic)}</span>
          <button type="button" onClick={() => onLocate(diagnostic.from, diagnostic.to)}>
            {t("prompt.locateContent")}
          </button>
        </div>
      ))}
      {statistics.analysisError && (
        <div className="prompt-analysis-error" role="alert">
          <TriangleAlert size={12} aria-hidden />
          <span>{t("prompt.analysisFailed", { value0: statistics.analysisError })}</span>
          <button type="button" onClick={statistics.retryAnalysis}>
            {t("prompt.retry")}
          </button>
        </div>
      )}
    </>
  );
}

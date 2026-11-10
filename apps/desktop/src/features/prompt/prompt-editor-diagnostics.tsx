import { IconButton, overlayStyles, Button } from "@/shared/ui";

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
        render={
          <IconButton
            label={`${label} · ${status}${diagnostics.length ? ` · ${t("prompt.diagnosticCount", { count: diagnostics.length })}` : ""}`}
          />
        }
        className={`prompt-editor-action prompt-token-indicator icon-button${hasIssue ? " danger text-danger" : ""}`}
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
        <Popover.Positioner
          side="top"
          align="end"
          sideOffset={5}
          className={`help-positioner ${overlayStyles["help-positioner"]}`}
        >
          <Popover.Popup
            className="prompt-token-popup max-w-[min(360px,_calc(100vw_-_24px))] p-[7px_10px] [border:1px_solid_var(--line)] rounded-overlay bg-raised text-foreground shadow-overlay text-label [&_p]:m-0 [&_.prompt-selection-detail]:mt-[5px] [&_.prompt-selection-detail]:text-muted"
            initialFocus={false}
          >
            <Popover.Description>{status}</Popover.Description>
            {details.length > 0 && <p className="prompt-selection-detail">{details.join(" · ")}</p>}
            {diagnostics.length > 0 && (
              <ul
                className="prompt-diagnostic-list [&]:list-none [&]:p-0 [&]:[margin:6px_0_0] [&]:max-h-[200px] [&]:overflow-auto [&_button]:flex [&_button]:gap-[5px] [&_button]:items-baseline [&_button]:w-full [&_button]:h-auto [&_button]:text-left [&_button]:whitespace-normal"
                aria-label={t("prompt.syntaxDiagnostics")}
              >
                {diagnostics.map((item, index) => (
                  <li key={index}>
                    <Button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onLocate(item.from, item.to);
                      }}
                    >
                      <TriangleAlert size={12} aria-hidden />
                      {item.message}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {(analysisError || tokenError) && (
              <Button type="button" onClick={analysisError ? retryAnalysis : retryCount}>
                {t("prompt.retry")}
              </Button>
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
        <div
          className="prompt-analysis-error [&]:flex [&]:items-center [&]:gap-[5px] [&]:mt-space-1 [&]:text-danger [&]:text-caption [&_span]:min-w-0 [&_span]:wrap-anywhere"
          role="alert"
        >
          <TriangleAlert size={12} aria-hidden />
          <span>{t("lexicon.insertionFailed", { detail: insertionError })}</span>
        </div>
      )}
      {statistics.document?.sourceDiagnostics.map((diagnostic, index) => (
        <div
          key={index}
          className="prompt-analysis-error [&]:flex [&]:items-center [&]:gap-[5px] [&]:mt-space-1 [&]:text-danger [&]:text-caption [&_span]:min-w-0 [&_span]:wrap-anywhere"
          role="alert"
        >
          <TriangleAlert size={12} aria-hidden />
          <span>{sourceDiagnosticMessage(diagnostic)}</span>
          <Button type="button" onClick={() => onLocate(diagnostic.from, diagnostic.to)}>
            {t("prompt.locateContent")}
          </Button>
        </div>
      ))}
      {statistics.analysisError && (
        <div
          className="prompt-analysis-error [&]:flex [&]:items-center [&]:gap-[5px] [&]:mt-space-1 [&]:text-danger [&]:text-caption [&_span]:min-w-0 [&_span]:wrap-anywhere"
          role="alert"
        >
          <TriangleAlert size={12} aria-hidden />
          <span>{t("prompt.analysisFailed", { value0: statistics.analysisError })}</span>
          <Button type="button" onClick={statistics.retryAnalysis}>
            {t("prompt.retry")}
          </Button>
        </div>
      )}
    </>
  );
}

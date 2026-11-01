import { t, useTranslation, useMessageState } from "@/shared/i18n";
import { useId, useState } from "react";
import { BookOpen, ListFilter } from "lucide-react";
import { LexiconBrowser } from "@/features/lexicon/lexicon-browser";
import type { PromptDocument } from "@/bindings/prompt";
import type { PromptContext } from "./analysis-protocol";
import { usePromptEditor } from "./use-prompt-editor";
import { usePromptEditorStatistics } from "./use-prompt-editor-statistics";
import { usePromptLexiconInsertion } from "./use-prompt-lexicon-insertion";
import { PromptEditorDiagnostics, PromptEditorErrors } from "./prompt-editor-diagnostics";
import { semanticDescription } from "./editor-semantics";
import { useFormattingContext } from "./format-context";
import "./text-assist.css";

/** Compose persistent editing, analysis feedback and lexicon insertion for every prompt source. */
export function PromptTextEditor({
  value,
  onChange,
  label,
  placeholder,
  model,
  disabled = false,
  readOnly = false,
  collapsed = false,
  onExpand,
  sizing = "bounded",
  context = "editable",
  analysisDocument,
  precedingSources = [],
  tokenUnavailableLabel = t("prompt.waitingForModel"),
}: {
  value: string;
  onChange?: (text: string) => void;
  label: string;
  placeholder?: string;
  model?: string;
  disabled?: boolean;
  readOnly?: boolean;
  collapsed?: boolean;
  onExpand?: () => void;
  sizing?: "bounded" | "content";
  context?: PromptContext;
  /** Rust's complete composition analysis retains source fragment boundaries. */
  analysisDocument?: PromptDocument;
  precedingSources?: string[] | null;
  tokenUnavailableLabel?: string;
}) {
  const { i18n } = useTranslation();
  const descriptionId = useId();
  const [position, setPosition] = useState(0);
  const [insertionError, setInsertionError] = useMessageState();
  const formattingContext = useFormattingContext(precedingSources);
  const statistics = usePromptEditorStatistics({
    value,
    model,
    context,
    analysisDocument,
    tokenUnavailableLabel,
  });
  const { hostRef, viewRef, disabledProbe, format, formatting } = usePromptEditor(
    {
      value,
      label,
      descriptionId,
      placeholder,
      disabled,
      readOnly: readOnly || !onChange,
      language: i18n.resolvedLanguage ?? i18n.language,
      profile: statistics.profile,
      analysisContext: statistics.analysisContext,
      analysisPending: statistics.analysisPending,
    },
    statistics.document,
    onChange,
    setPosition,
    setInsertionError,
    {
      visible: !collapsed,
      sizing,
      formattingContext: context === "editable" ? formattingContext : undefined,
    },
  );
  const lexicon = usePromptLexiconInsertion(viewRef);
  const details = semanticDescription(statistics.document, position);

  const focusEditor = (range?: { from: number; to: number }) => {
    if (collapsed) onExpand?.();
    requestAnimationFrame(() => {
      const view = viewRef.current;
      if (!view || hostRef.current?.hidden) return;
      view.requestMeasure();
      if (range)
        view.dispatch({ selection: { anchor: range.from, head: range.to }, scrollIntoView: true });
      view.focus();
    });
  };

  const locate = (from: number, to: number) => focusEditor({ from, to });

  return (
    <div
      className={`prompt-text-editor${readOnly ? " prompt-text-readonly" : ""}`}
      data-sizing={sizing}
      data-collapsed={collapsed || undefined}
      data-formattable={
        (!collapsed && !readOnly && Boolean(onChange) && context === "editable") || undefined
      }
    >
      <input ref={disabledProbe} type="hidden" disabled={disabled} />
      <div className="prompt-editor-surface">
        <div className="prompt-editor-host" ref={hostRef} hidden={collapsed} />
        {collapsed && (
          <button
            type="button"
            className="prompt-editor-preview"
            disabled={disabled}
            aria-label={`${label} · ${t("prompt.expandEditor")}`}
            aria-describedby={descriptionId}
            title={t("prompt.expandEditor")}
            onClick={() => focusEditor()}
          >
            <span>{value || placeholder || label}</span>
          </button>
        )}
        <div className="prompt-editor-actions">
          <PromptEditorDiagnostics
            statistics={statistics}
            details={details}
            label={label}
            disabled={disabled}
            onLocate={locate}
          />
          {!collapsed && !readOnly && onChange && context === "editable" && (
            <button
              type="button"
              className="prompt-editor-action icon-button"
              disabled={disabled || formatting || !statistics.profile || precedingSources === null}
              aria-busy={formatting}
              aria-keyshortcuts="Alt+Shift+F"
              title={t(
                precedingSources === null
                  ? "prompt.formatContextUnavailable"
                  : "prompt.formatShortcut",
              )}
              aria-label={`${label} · ${t("prompt.format")}`}
              onClick={format}
            >
              <ListFilter size={13} aria-hidden />
            </button>
          )}
          {!collapsed && (
            <button
              type="button"
              className="prompt-editor-action icon-button"
              disabled={disabled}
              title={t("lexicon.title")}
              aria-label={`${label} · ${t("lexicon.title")}`}
              onClick={lexicon.show}
            >
              <BookOpen size={13} aria-hidden />
            </button>
          )}
        </div>
      </div>
      {lexicon.open && (
        <LexiconBrowser
          open
          onClose={lexicon.close}
          onInsert={lexicon.insertTerms}
          returnFocus={() => viewRef.current?.contentDOM ?? null}
          profile={statistics.profile}
          readOnly={readOnly || !onChange}
        />
      )}
      <span id={descriptionId} className="prompt-editor-description">
        {t("prompt.editorHelp")} {statistics.status}
      </span>
      <PromptEditorErrors
        statistics={statistics}
        insertionError={insertionError}
        onLocate={locate}
      />
    </div>
  );
}

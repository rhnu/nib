import { IconButton, Input, Button, Col } from "@/shared/ui";

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
      className={`prompt-text-editor [--prompt-weight-up:#f0b89b] [--prompt-weight-down:#a0c4ed] [--prompt-weight-negative:#e7a3d5] [:root[data-theme='light']_&]:[--prompt-weight-up:#914119] [:root[data-theme='light']_&]:[--prompt-weight-down:#275d94] [:root[data-theme='light']_&]:[--prompt-weight-negative:#9c347e] [&[data-sizing='content']]:[--prompt-editor-min-height:62px] [&[data-sizing='content']]:[--prompt-editor-padding-y:4px] [&[data-sizing='content']]:[--prompt-editor-max-height:none] [&[data-formattable]]:[--prompt-editor-min-height:90px] [&]:relative [&]:min-w-0 [&_.prompt-editor-action.icon-button]:w-[26px] [&_.prompt-editor-action.icon-button]:h-[26px] [&_.prompt-editor-action.icon-button]:min-h-[26px] [&_.prompt-editor-action.icon-button]:p-0 [&_.prompt-editor-action.icon-button]:border [&_.prompt-editor-action.icon-button]:border-transparent [&_.prompt-editor-action.icon-button]:rounded-control [&_.prompt-editor-action.icon-button]:text-muted [&_.prompt-editor-action.icon-button]:bg-input [&_.prompt-editor-action.icon-button:hover:not(:disabled)]:bg-hover [&_.prompt-editor-action.danger]:text-danger${readOnly ? " prompt-text-readonly" : ""}`}
      data-sizing={sizing}
      data-collapsed={collapsed || undefined}
      data-formattable={
        (!collapsed && !readOnly && Boolean(onChange) && context === "editable") || undefined
      }
    >
      <Input ref={disabledProbe} type="hidden" disabled={disabled} />
      <div className="prompt-editor-surface [&]:relative [&]:min-w-0">
        <div
          className="prompt-editor-host [border:1px_solid_var(--line)] rounded-control overflow-hidden [&:focus-within]:border-accent [&:focus-within]:[outline:1px_solid_var(--accent)] [&:focus-within]:outline-offset-[-1px] [&:has([aria-disabled='true'])]:opacity-55"
          ref={hostRef}
          hidden={collapsed}
        />
        {collapsed && (
          <Button
            type="button"
            className="prompt-editor-preview [&]:flex [&]:justify-start [&]:w-full [&]:min-w-0 [&]:h-[34px] [&]:min-h-[34px] [&]:[padding:4px_36px_4px_9px] [&]:text-left [&]:text-muted [&]:bg-input [&]:font-mono [&]:text-body [&_>_span]:min-w-0 [&_>_span]:overflow-hidden [&_>_span]:text-ellipsis [&_>_span]:whitespace-nowrap"
            disabled={disabled}
            aria-label={`${label} · ${t("prompt.expandEditor")}`}
            aria-describedby={descriptionId}
            title={t("prompt.expandEditor")}
            onClick={() => focusEditor()}
          >
            <span>{value || placeholder || label}</span>
          </Button>
        )}
        <Col gap={0} className="prompt-editor-actions absolute top-space-1 right-space-1 gap-[2px]">
          <PromptEditorDiagnostics
            statistics={statistics}
            details={details}
            label={label}
            disabled={disabled}
            onLocate={locate}
          />
          {!collapsed && !readOnly && onChange && context === "editable" && (
            <IconButton
              label={`${label} · ${t("prompt.format")}`}
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
            </IconButton>
          )}
          {!collapsed && (
            <IconButton
              label={`${label} · ${t("lexicon.title")}`}
              type="button"
              className="prompt-editor-action icon-button"
              disabled={disabled}
              title={t("lexicon.title")}
              aria-label={`${label} · ${t("lexicon.title")}`}
              onClick={lexicon.show}
            >
              <BookOpen size={13} aria-hidden />
            </IconButton>
          )}
        </Col>
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
      <span
        id={descriptionId}
        className="prompt-editor-description [&]:absolute [&]:w-[1px] [&]:h-[1px] [&]:p-0 [&]:overflow-hidden [&]:[clip-path:inset(50%)] [&]:whitespace-nowrap"
      >
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

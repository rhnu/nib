import { t, useTranslation, formatNumber, useMessageState } from "@/shared/i18n";
import { useId, useRef, useState } from "react";
import { isolateHistory } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { useQuery } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { BookOpen, Circle, LoaderCircle, TriangleAlert } from "lucide-react";
import { LexiconBrowser } from "@/features/lexicon/lexicon-browser";
import { isCurrentLexicon, lexiconRevision } from "@/features/lexicon/api";
import { useLexiconStatus } from "@/features/lexicon/use-lexicon-status";
import { errorMessage } from "@/shared/host/error";
import type { PromptDocument } from "@/bindings/prompt";
import { promptApi } from "./api";
import type { PromptContext } from "./analysis-protocol";
import { usePromptAnalysis } from "./use-prompt-analysis";
import { usePromptEditor } from "./use-prompt-editor";
import { promptDiagnostics, sourceDiagnosticMessage } from "./editor-diagnostics";
import { semanticDescription } from "./editor-semantics";
import { promptAnalysis, promptRevision, promptProfile } from "./editor-analysis";
import { formatLexiconTerms } from "./format-runtime";
import "./text-assist.css";

/** Source editors and native result readers share a persistent CodeMirror view and Rust analysis. */
export function PromptTextEditor({
  value,
  onChange,
  label,
  placeholder,
  model,
  disabled = false,
  readOnly = false,
  context = "editable",
  analysisDocument,
  tokenUnavailableLabel = t("prompt.waitingForModel"),
}: {
  value: string;
  onChange?: (text: string) => void;
  label: string;
  placeholder?: string;
  model?: string;
  disabled?: boolean;
  readOnly?: boolean;
  context?: PromptContext;
  /** Rust's complete composition analysis retains source fragment boundaries. */
  analysisDocument?: PromptDocument;
  tokenUnavailableLabel?: string;
}) {
  const { i18n } = useTranslation();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(0);
  const [lexiconOpen, setLexiconOpen] = useState(false);
  const insertionState = useRef<EditorState | null>(null);
  const insertionSession = useRef(0);
  const [insertionError, setInsertionError] = useMessageState();
  useLexiconStatus();
  const liveAnalysis = usePromptAnalysis(value, model, context, {
    enabled: analysisDocument === undefined,
  });
  const analysis =
    analysisDocument === undefined
      ? liveAnalysis
      : {
          document: analysisDocument,
          pending: false,
          error: "",
          retry: liveAnalysis.retry,
        };
  const diagnostics = promptDiagnostics(analysis.document);
  const sourceInvalid = Boolean(analysis.document?.sourceDiagnostics.length);
  const tokenText = analysis.document?.text;
  const tokenReady = tokenText !== undefined && !sourceInvalid;
  const query = useQuery({
    queryKey: ["prompt-tokens", model, tokenText, "content_only"],
    // Rust already removed source comments. The SDK receives native prompt text exactly once.
    queryFn: () => promptApi.inspectTokens(model!, tokenText!, "content_only"),
    enabled: Boolean(model) && tokenReady,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const count = tokenReady ? query.data?.count.used : undefined;
  const tokenError = tokenReady && query.error ? errorMessage(query.error) : "";
  const pending = analysis.pending || (Boolean(model) && tokenReady && query.isPending);
  const status = analysis.error
    ? t("prompt.analysisFailed", { value0: analysis.error })
    : sourceInvalid
      ? t("prompt.fixSourceBeforeCounting")
      : !model
        ? tokenUnavailableLabel
        : tokenError
          ? t("prompt.tokenCountFailed", { value0: tokenError })
          : count === undefined
            ? t("prompt.countingTokens")
            : t("prompt.tokenCount", { count, formattedCount: formatNumber(count) });
  const { hostRef, viewRef, disabledProbe } = usePromptEditor(
    {
      value,
      label,
      descriptionId,
      placeholder,
      disabled,
      readOnly: readOnly || !onChange,
      language: i18n.resolvedLanguage ?? i18n.language,
      profile: liveAnalysis.profile,
    },
    analysis.document,
    onChange,
    setPosition,
    setInsertionError,
  );
  const details = semanticDescription(analysis.document, position);
  const hasIssue = Boolean(analysis.error || tokenError || diagnostics.length);

  const locate = (from: number, to: number) => {
    const view = viewRef.current;
    if (!view) return;
    setOpen(false);
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    view.focus();
  };

  const insertTerms = async (
    terms: { name: string; weight: number }[],
    generation: string | null,
  ) => {
    const view = viewRef.current;
    const snapshot = insertionState.current;
    const session = insertionSession.current;
    if (
      !view ||
      !snapshot ||
      view.state.field(promptRevision) !== snapshot.field(promptRevision) ||
      view.compositionStarted ||
      view.state.readOnly ||
      !isCurrentLexicon(generation, lexiconRevision())
    )
      return false;
    const selection = view.state.selection.main;
    const profile = view.state.field(promptProfile);
    if (!profile) return false;
    const document = view.state.field(promptAnalysis);
    const range = document?.completionRanges.find(
      (item) => item.from <= selection.from && selection.to <= item.to,
    );
    // An empty source is a valid initial insertion; all other grammar positions come from Rust.
    if (!range && view.state.doc.length !== 0) return false;
    const from = selection.empty ? (range?.to ?? 0) : selection.from;
    const to = selection.empty ? from : selection.to;
    const startedRevision = lexiconRevision();
    const termsText = await formatLexiconTerms(terms, profile);
    if (
      insertionSession.current !== session ||
      viewRef.current !== view ||
      view.state.field(promptRevision) !== snapshot.field(promptRevision) ||
      view.state.field(promptProfile) !== profile ||
      view.compositionStarted ||
      view.state.readOnly ||
      !isCurrentLexicon(generation, startedRevision)
    )
      return false;
    const insert = `${selection.empty && range && range.from < range.to ? ", " : ""}${termsText}`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      annotations: [Transaction.userEvent.of("input.complete"), isolateHistory.of("full")],
    });
    requestAnimationFrame(() => view.focus());
    return true;
  };

  return (
    <div className={`prompt-text-editor${readOnly ? " prompt-text-readonly" : ""}`}>
      <input ref={disabledProbe} type="hidden" disabled={disabled} />
      <div className="prompt-editor-host" ref={hostRef} />
      {insertionError && (
        <div className="prompt-analysis-error" role="alert">
          <TriangleAlert size={12} aria-hidden />
          <span>{t("lexicon.insertionFailed", { detail: insertionError })}</span>
        </div>
      )}
      <button
        type="button"
        className="prompt-lexicon-trigger icon-button"
        disabled={disabled}
        title={t("lexicon.title")}
        aria-label={`${label} · ${t("lexicon.title")}`}
        onClick={() => {
          insertionState.current = viewRef.current?.state ?? null;
          insertionSession.current++;
          setLexiconOpen(true);
        }}
      >
        <BookOpen size={13} aria-hidden />
      </button>
      {lexiconOpen && (
        <LexiconBrowser
          open
          onClose={() => {
            insertionSession.current++;
            setLexiconOpen(false);
          }}
          onInsert={insertTerms}
          returnFocus={() => viewRef.current?.contentDOM ?? null}
          numericWeights={Boolean(liveAnalysis.profile?.numericWeights)}
          negativeWeights={Boolean(liveAnalysis.profile?.negativeWeights)}
          bracketWeights={Boolean(liveAnalysis.profile?.bracketWeights)}
          readOnly={readOnly || !onChange}
        />
      )}
      <span id={descriptionId} className="prompt-editor-description">
        {t("prompt.editorHelp")} {status}
      </span>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          className={`prompt-token-indicator icon-button${hasIssue ? " danger" : ""}`}
          disabled={disabled}
          aria-label={`${label} · ${status}${diagnostics.length ? ` · ${t("prompt.diagnosticCount", { count: diagnostics.length })}` : ""}`}
          openOnHover
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible")) setOpen(true);
          }}
        >
          {hasIssue ? (
            <TriangleAlert size={13} aria-hidden />
          ) : pending ? (
            <LoaderCircle size={13} className="spin" aria-hidden />
          ) : (
            <Circle size={13} aria-hidden />
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="top" align="end" sideOffset={5} className="help-positioner">
            <Popover.Popup className="prompt-token-popup" initialFocus={false}>
              <Popover.Description>{status}</Popover.Description>
              {details.length > 0 && (
                <p className="prompt-selection-detail">{details.join(" · ")}</p>
              )}
              {diagnostics.length > 0 && (
                <ul className="prompt-diagnostic-list" aria-label={t("prompt.syntaxDiagnostics")}>
                  {diagnostics.map((item, index) => (
                    <li key={index}>
                      <button type="button" onClick={() => locate(item.from, item.to)}>
                        <TriangleAlert size={12} aria-hidden />
                        {item.message}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {(analysis.error || tokenError) && (
                <button
                  type="button"
                  onClick={analysis.error ? analysis.retry : () => void query.refetch()}
                >
                  {t("prompt.retry")}
                </button>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {analysis.document?.sourceDiagnostics.map((diagnostic, index) => (
        <div key={index} className="prompt-analysis-error" role="alert">
          <TriangleAlert size={12} aria-hidden />
          <span>{sourceDiagnosticMessage(diagnostic)}</span>
          <button
            type="button"
            onClick={() => {
              locate(diagnostic.from, diagnostic.to);
            }}
          >
            {t("prompt.locateContent")}
          </button>
        </div>
      ))}
      {analysis.error && (
        <div className="prompt-analysis-error" role="alert">
          <TriangleAlert size={12} aria-hidden />
          <span>{t("prompt.analysisFailed", { value0: analysis.error })}</span>
          <button type="button" onClick={analysis.retry}>
            {t("prompt.retry")}
          </button>
        </div>
      )}
    </div>
  );
}

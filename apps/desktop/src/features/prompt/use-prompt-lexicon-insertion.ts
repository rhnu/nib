import { useRef, useState, type RefObject } from "react";
import { isolateHistory } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { LexiconFormatTerm } from "@/bindings/prompt";
import { isCurrentLexicon, lexiconRevision } from "@/features/lexicon/api";
import { useLexiconStatus } from "@/features/lexicon/use-lexicon-status";
import { promptAnalysis, promptRevision, promptProfile } from "./editor-analysis";
import { formatLexiconTerms } from "./format-runtime";

/** A browser insertion owns its selection snapshot and rejects stale asynchronous formatting. */
export function usePromptLexiconInsertion(viewRef: RefObject<EditorView | null>) {
  const [open, setOpen] = useState(false);
  const insertionState = useRef<EditorState | null>(null);
  const insertionSession = useRef(0);
  useLexiconStatus();

  const insertTerms = async (terms: LexiconFormatTerm[], generation: string | null) => {
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

  return {
    open,
    show: () => {
      insertionState.current = viewRef.current?.state ?? null;
      insertionSession.current++;
      setOpen(true);
    },
    close: () => {
      insertionSession.current++;
      setOpen(false);
    },
    insertTerms,
  };
}

import {
  autocompletion,
  closeCompletion,
  pickedCompletion,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { LexiconStatus } from "@/bindings/lexicon";
import {
  lexiconApi,
  lexiconRevision,
  isCurrentLexicon,
  lexiconStatusKey,
} from "@/features/lexicon/api";
import { kindLabel, reasonLabel } from "@/features/lexicon/labels";
import { queryClient } from "@/shared/query/client";
import {
  promptAnalysis,
  promptRevision,
  promptProfile,
  promptInsertionError,
  setPromptAnalysis,
} from "./editor-analysis";
import { formatLexiconTerms } from "./format-runtime";

/** All grammar boundaries are supplied by Rust; the UI only reads a tag's source text. */
export function completionRange(state: EditorState) {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  const analysis = state.field(promptAnalysis);
  return (
    analysis?.completionRanges.find(
      (range) => range.from < selection.head && selection.head <= range.to,
    ) ?? null
  );
}

function completionSource(semantic: boolean) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const view = context.view;
    const range = completionRange(context.state);
    if (
      semantic &&
      queryClient.getQueryData<LexiconStatus>(lexiconStatusKey)?.semanticAvailable === false
    )
      return null;
    if (
      !view ||
      !range ||
      view.compositionStarted ||
      !view.hasFocus ||
      view.contentDOM.getAttribute("aria-disabled") === "true"
    )
      return null;
    const revision = lexiconRevision();
    const editorRevision = context.state.field(promptRevision);
    const analysis = context.state.field(promptAnalysis);
    const profile = context.state.field(promptProfile);
    let aborted = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let finishDelay: (() => void) | undefined;
    context.addEventListener(
      "abort",
      () => {
        aborted = true;
        clearTimeout(timer);
        finishDelay?.();
      },
      { onDocChange: true },
    );

    const current = () =>
      !aborted &&
      !context.aborted &&
      view.hasFocus &&
      !view.compositionStarted &&
      view.state.field(promptRevision) === editorRevision &&
      view.state.field(promptAnalysis) === analysis &&
      view.state.field(promptProfile) === profile &&
      lexiconRevision() === revision;

    if (semantic) {
      await new Promise<void>((resolve) => {
        finishDelay = resolve;
        timer = setTimeout(resolve, 350);
      });
      if (!current()) return null;
    }
    const text = context.state.sliceDoc(range.from, context.pos);
    try {
      const result = await lexiconApi.search(text, [], semantic);
      if (!current() || !isCurrentLexicon(result.generation, revision)) return null;
      const matches = result.matches.filter(
        (match) => semantic === (match.reason === "semantic" || match.reason === "related"),
      );
      return {
        from: range.from,
        to: range.to,
        filter: false,
        options: matches.map((match) => ({
          label: match.term.promptText,
          detail: [match.term.translation, kindLabel(match.term.kind), reasonLabel(match.reason)]
            .filter(Boolean)
            .join(" · "),
          info: [
            match.term.description,
            match.term.aliases.join(", "),
            match.term.groups.join(" · "),
            match.term.source,
          ]
            .filter(Boolean)
            .join("\n"),
          apply(target, completion) {
            if (
              target !== view ||
              !current() ||
              !profile ||
              target.state.readOnly ||
              !isCurrentLexicon(result.generation, revision)
            )
              return;
            void formatLexiconTerms([{ name: match.term.promptText, weight: null }], profile)
              .then((insert) => {
                if (
                  !current() ||
                  target.state.readOnly ||
                  !isCurrentLexicon(result.generation, revision)
                )
                  return;
                target.dispatch({
                  changes: { from: range.from, to: range.to, insert },
                  selection: { anchor: range.from + insert.length },
                  annotations: [
                    pickedCompletion.of(completion),
                    Transaction.userEvent.of("input.complete"),
                    isolateHistory.of("full"),
                  ],
                });
              })
              .catch((cause: unknown) => {
                if (current()) target.dispatch({ effects: promptInsertionError.of(cause) });
              });
          },
        })),
      };
    } catch {
      // Optional lookup failures must not interrupt ordinary editing; the browser exposes retry.
      return null;
    }
  };
}

/** Independent sources let CodeMirror display lexical matches before semantic inference finishes. */
export const promptCompletion = [
  autocompletion({
    override: [completionSource(false), completionSource(true)],
    activateOnTypingDelay: 0,
    updateSyncTime: 0,
    selectOnOpen: false,
    icons: false,
    maxRenderedOptions: 30,
    tooltipClass: () => "prompt-completion-popup",
  }),
  ViewPlugin.fromClass(
    class {
      view: EditorView;

      timer: ReturnType<typeof setTimeout> | undefined;

      unsubscribe: () => void;

      constructor(view: EditorView) {
        this.view = view;
        let generation = queryClient.getQueryData<LexiconStatus>(lexiconStatusKey)?.generation;
        this.unsubscribe = queryClient.getQueryCache().subscribe((event) => {
          if (event.query.queryKey[0] === lexiconStatusKey[0] && event.type === "updated") {
            const next = queryClient.getQueryData<LexiconStatus>(lexiconStatusKey)?.generation;
            if (generation === next) return;
            generation = next;
            clearTimeout(this.timer);
            this.timer = setTimeout(() => {
              closeCompletion(view);
              if (view.hasFocus && !view.compositionStarted && completionRange(view.state))
                startCompletion(view);
            }, 0);
          }
        });
      }

      update(update: ViewUpdate) {
        if (
          !update.selectionSet &&
          !update.transactions.some((transaction) =>
            transaction.effects.some((effect) => effect.is(setPromptAnalysis)),
          )
        )
          return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          if (!this.view.state.field(promptAnalysis)) closeCompletion(this.view);
          if (
            this.view.hasFocus &&
            !this.view.compositionStarted &&
            completionRange(this.view.state)
          )
            startCompletion(this.view);
        }, 0);
      }

      destroy() {
        clearTimeout(this.timer);
        this.unsubscribe();
      }
    },
  ),
];

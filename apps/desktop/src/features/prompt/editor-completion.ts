import {
  autocompletion,
  closeCompletion,
  completionKeymap,
  completionStatus,
  pickedCompletion,
  startCompletion,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { EditorState, Prec, StateEffect, StateField, Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view";
import type { LexiconMatch, LexiconStatus } from "@/bindings/lexicon";
import type { TextRange } from "@/bindings/prompt";
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
  promptContext,
  promptRevision,
  promptProfile,
  promptInsertionError,
  setPromptAnalysis,
} from "./editor-analysis";
import { lookupCompletions } from "./completion-lookup";
import { formatLexiconTerms } from "./format-runtime";

type CompletionSnapshot = {
  result: CompletionResult;
  range: TextRange;
  current: (state: EditorState) => boolean;
};

const setCompletions = StateEffect.define<CompletionSnapshot | null>();

/** Retained coordinates only position the old list; insertion always requires current analysis. */
const completions = StateField.define<CompletionSnapshot | null>({
  create: () => null,
  update(value, transaction) {
    if (value && transaction.docChanged) {
      value = {
        ...value,
        range: {
          from: transaction.changes.mapPos(value.range.from, -1),
          to: transaction.changes.mapPos(value.range.to, 1),
        },
      };
    }
    for (const effect of transaction.effects) {
      if (effect.is(setCompletions)) value = effect.value;
    }
    return value;
  },
});

/** All grammar boundaries are supplied by Rust; the UI only reads a tag's source text. */
export function completionRange(state: EditorState) {
  const selection = state.selection.main;
  if (!selection.empty) return null;
  return (
    state
      .field(promptAnalysis)
      ?.completionRanges.find(
        (range) => range.from < selection.head && selection.head <= range.to,
      ) ?? null
  );
}

/** Reuse an existing comma and horizontal spacing, leaving the next tag and syntax intact. */
export function completionInsertion(state: EditorState, range: TextRange, text: string) {
  const suffix = state.sliceDoc(range.to, state.doc.lineAt(range.to).to);
  const separator = /^[\t ]*(?:,[\t ]*)?/.exec(suffix)![0];
  const insert = `${text}, `;
  return {
    changes: { from: range.from, to: range.to + separator.length, insert },
    selection: { anchor: range.from + insert.length },
  };
}

function completionResult(
  view: EditorView,
  range: TextRange,
  matches: LexiconMatch[],
  current: (state: EditorState) => boolean,
): CompletionResult {
  const profile = view.state.field(promptProfile)!;
  return {
    from: range.from,
    to: range.to,
    filter: false,
    // Keep the unfiltered list during analysis and lookup; stale apply callbacks remain inert.
    update: (result, from, to) => ({ ...result, from, to }),
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
        if (target !== view || !current(target.state)) return;
        void formatLexiconTerms([{ name: match.term.promptText, weight: null }], profile)
          .then((insert) => {
            if (!current(target.state)) return;
            target.dispatch({
              ...completionInsertion(target.state, range, insert),
              annotations: [
                pickedCompletion.of(completion),
                Transaction.userEvent.of("input.complete"),
                isolateHistory.of("full"),
              ],
            });
          })
          .catch((cause: unknown) => {
            if (current(target.state)) target.dispatch({ effects: promptInsertionError.of(cause) });
          });
      },
    })),
  };
}

/** Query outside CodeMirror so its pending-source timeout cannot clear a visible list. */
class CompletionQueries {
  view: EditorView;

  timer: ReturnType<typeof setTimeout> | undefined;

  cancelLookup: (() => void) | undefined;

  lastInteraction = Date.now();

  session = 0;

  closePending = false;

  closing = false;

  dismissedRevision: number | null = null;

  unsubscribe: () => void;

  constructor(view: EditorView) {
    this.view = view;
    let generation = queryClient.getQueryData<LexiconStatus>(lexiconStatusKey)?.generation;
    this.unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] !== lexiconStatusKey[0] || event.type !== "updated") return;
      const next = queryClient.getQueryData<LexiconStatus>(lexiconStatusKey)?.generation;
      if (generation === next) return;
      generation = next;
      this.schedule(true);
    });
  }

  update(update: ViewUpdate) {
    const interacted = update.docChanged || update.selectionSet;
    if (
      !this.closing &&
      !interacted &&
      completionStatus(update.startState) &&
      !completionStatus(update.state)
    ) {
      this.session++;
      clearTimeout(this.timer);
      this.cancelLookup?.();
      this.dismissedRevision = update.state.field(promptRevision);
    }
    const contextChanged =
      update.startState.field(promptContext) !== update.state.field(promptContext) ||
      update.startState.field(promptProfile) !== update.state.field(promptProfile) ||
      update.startState.readOnly !== update.state.readOnly;
    if (
      !interacted &&
      !contextChanged &&
      !update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(setPromptAnalysis)),
      )
    )
      return;
    if (interacted) {
      this.lastInteraction = Date.now();
      this.dismissedRevision = null;
    }
    this.schedule(contextChanged || (update.selectionSet && !update.docChanged));
  }

  close() {
    this.closing = true;
    try {
      closeCompletion(this.view);
    } finally {
      this.closing = false;
    }
  }

  request() {
    this.dismissedRevision = null;
    this.lastInteraction = Date.now() - 350;
    this.schedule();
  }

  schedule(close = false) {
    clearTimeout(this.timer);
    this.cancelLookup?.();
    this.session++;
    this.closePending ||= close;
    if (close) this.dismissedRevision = null;
    // Dispatch outside ViewPlugin.update, after all fields have received the transaction.
    this.timer = setTimeout(() => {
      const { view } = this;
      const state = view.state;
      const range = completionRange(state);
      const previous = state.field(completions);
      if (
        this.closePending ||
        state.readOnly ||
        (state.field(promptAnalysis) &&
          (!range ||
            (previous && (previous.range.from !== range.from || previous.range.to !== range.to))))
      ) {
        this.close();
        view.dispatch({ effects: setCompletions.of(null) });
      }
      this.closePending = false;
      if (
        !range ||
        !state.field(promptProfile) ||
        !view.hasFocus ||
        view.compositionStarted ||
        state.readOnly ||
        this.dismissedRevision === state.field(promptRevision)
      )
        return;
      const session = this.session;
      const revision = lexiconRevision();
      const status = queryClient.getQueryData<LexiconStatus>(lexiconStatusKey);
      const generation = status?.generation ?? null;
      // Wait for resource status instead of guessing availability during startup.
      if (!generation) return;
      const editorRevision = state.field(promptRevision);
      const analysis = state.field(promptAnalysis);
      const profile = state.field(promptProfile);

      const current = (latest: EditorState) =>
        this.session === session &&
        view.hasFocus &&
        !view.compositionStarted &&
        !latest.readOnly &&
        latest.field(promptRevision) === editorRevision &&
        latest.field(promptAnalysis) === analysis &&
        latest.field(promptProfile) === profile &&
        isCurrentLexicon(generation, revision);

      this.cancelLookup = lookupCompletions(
        {
          text: state.sliceDoc(range.from, state.selection.main.head),
          semantic: status?.semanticAvailable === true,
          elapsed: Date.now() - this.lastInteraction,
        },
        (text, semantic) => lexiconApi.search(text, [], semantic),
        (result) =>
          current(view.state) && (!result || isCurrentLexicon(result.generation, revision)),
        (matches) => {
          const snapshot = {
            range,
            current,
            result: completionResult(view, range, matches, current),
          };
          view.dispatch({ effects: setCompletions.of(snapshot) });
          if (matches.length) startCompletion(view);
          else this.close();
        },
      );
    }, 0);
  }

  destroy() {
    this.session++;
    clearTimeout(this.timer);
    this.cancelLookup?.();
    this.unsubscribe();
  }
}

const completionQueries = ViewPlugin.fromClass(CompletionQueries);

export const promptCompletion = [
  completions,
  autocompletion({
    override: [
      (context) => {
        const snapshot = context.state.field(completions);
        return snapshot?.current(context.state) ? snapshot.result : null;
      },
    ],
    activateOnTyping: false,
    defaultKeymap: false,
    selectOnOpen: false,
    icons: false,
    maxRenderedOptions: 30,
    tooltipClass: (state) =>
      `prompt-completion-popup${state.field(completions)?.current(state) ? "" : " prompt-completion-pending"}`,
  }),
  completionQueries,
  Prec.highest(
    keymap.of(
      completionKeymap.map((binding) => ({
        ...binding,
        run(view) {
          if (binding.run === startCompletion) {
            view.plugin(completionQueries)?.request();
            return true;
          }
          // A retained list must not consume Enter or cursor movement while its matches are stale.
          if (
            binding.run !== closeCompletion &&
            !view.state.field(completions)?.current(view.state)
          )
            return false;
          return binding.run?.(view) ?? false;
        },
      })),
    ),
  ),
];

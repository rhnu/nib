import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import type { PromptSyntaxProfile } from "@/bindings/prompt";
import {
  promptAnalysis,
  promptRevision,
  promptProfile,
  promptInsertionError,
  promptContext,
  promptPending,
} from "./editor-analysis";
import { promptSemantics, promptSemanticTooltip } from "./editor-semantics";
import { promptEditorTheme } from "./editor-theme";
import { promptCompletion } from "./editor-completion";

export const externalPromptUpdate = Annotation.define<boolean>();

export function editorCompartments() {
  return { configuration: new Compartment(), language: new Compartment() };
}

export type EditorConfiguration = {
  value: string;
  label: string;
  descriptionId: string;
  placeholder?: string;
  disabled: boolean;
  readOnly: boolean;
  language: string;
  profile?: PromptSyntaxProfile;
  analysisContext: string;
  analysisPending: boolean;
};

export function editorConfiguration(configuration: EditorConfiguration) {
  return [
    EditorState.readOnly.of(configuration.readOnly || configuration.disabled),
    EditorView.editable.of(!configuration.readOnly && !configuration.disabled),
    EditorView.contentAttributes.of({
      "aria-label": configuration.label,
      "aria-describedby": configuration.descriptionId,
      "aria-multiline": "true",
      "aria-readonly": String(configuration.readOnly),
      "aria-disabled": String(configuration.disabled),
      role: "textbox",
      tabindex: configuration.disabled ? "-1" : "0",
      spellcheck: "false",
      autocapitalize: "off",
      autocorrect: "off",
    }),
    placeholder(configuration.placeholder ?? ""),
  ];
}

export function createPromptEditor(
  parent: HTMLElement,
  configuration: EditorConfiguration,
  compartments: ReturnType<typeof editorCompartments>,
  onChange: (value: string) => void,
  onSelection: (position: number) => void,
  onCompositionEnd: () => void,
  onInsertionError: (cause: unknown) => void,
) {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: configuration.value,
      extensions: [
        history(),
        drawSelection(),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        promptEditorTheme,
        promptContext,
        promptPending,
        promptAnalysis,
        promptRevision,
        promptProfile,
        promptSemantics,
        promptSemanticTooltip,
        promptCompletion,
        compartments.configuration.of(editorConfiguration(configuration)),
        compartments.language.of(EditorView.contentAttributes.of({ lang: configuration.language })),
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            !update.transactions.some((transaction) => transaction.annotation(externalPromptUpdate))
          ) {
            onChange(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged)
            onSelection(update.state.selection.main.head);
          if (update.docChanged) onInsertionError("");
          for (const transaction of update.transactions) {
            for (const effect of transaction.effects) {
              if (effect.is(promptInsertionError)) onInsertionError(effect.value);
            }
          }
        }),
        EditorView.domEventHandlers({ compositionend: onCompositionEnd }),
      ],
    }),
  });
}

/** Apply a minimal external replacement so CodeMirror maps the cursor through the change. */
export function synchronizePromptValue(view: EditorView, value: string) {
  const previous = view.state.doc.toString();
  if (previous === value) return;
  let from = 0;
  while (from < previous.length && from < value.length && previous[from] === value[from]) from++;
  let oldEnd = previous.length;
  let newEnd = value.length;
  while (oldEnd > from && newEnd > from && previous[oldEnd - 1] === value[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  view.dispatch({
    changes: { from, to: oldEnd, insert: value.slice(from, newEnd) },
    annotations: [externalPromptUpdate.of(true), Transaction.addToHistory.of(false)],
  });
}

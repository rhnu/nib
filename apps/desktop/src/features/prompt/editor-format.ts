import { isolateHistory } from "@codemirror/commands";
import { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { PromptFormat } from "@/bindings/prompt";
import { promptContext, promptProfile, promptRevision } from "./editor-analysis";
import type { FormattingContext } from "./format-context";
import { formatPrompt } from "./format-runtime";

/** Native edits map every selection and stay separate from adjacent typing in undo history. */
export function formattingTransaction(result: PromptFormat) {
  return {
    changes: result.changes,
    annotations: [Transaction.userEvent.of("input.format"), isolateHistory.of("full")],
  };
}

/** Both the toolbar and shortcut reject results invalidated during WASM/context loading. */
export async function formatPromptEditor(
  view: EditorView,
  context: () => Promise<FormattingContext>,
  current: () => boolean,
) {
  const snapshot = view.state;
  const profile = snapshot.field(promptProfile);

  const valid = () =>
    current() &&
    view.dom.isConnected &&
    !view.state.readOnly &&
    !view.compositionStarted &&
    !view.dom.closest("[inert]") &&
    view.contentDOM.getAttribute("aria-disabled") !== "true" &&
    view.state.field(promptRevision) === snapshot.field(promptRevision) &&
    view.state.field(promptContext) === snapshot.field(promptContext) &&
    view.state.field(promptProfile) === profile;

  if (!profile || !valid()) return;
  try {
    const prefix = await context();
    if (!valid() || !prefix.current()) return;
    const result = await formatPrompt(snapshot.doc.toString(), profile, prefix.precedingSources);
    if (!valid() || !prefix.current()) return;
    if (result.changes.length) view.dispatch(formattingTransaction(result));
    view.focus();
  } catch (cause) {
    if (valid()) throw cause;
  }
}

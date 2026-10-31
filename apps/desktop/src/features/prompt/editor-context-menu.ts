import { EditorView } from "@codemirror/view";
import { Transaction } from "@codemirror/state";
import { undo, redo, undoDepth, redoDepth, selectAll } from "@codemirror/commands";
import { registerTextEditor } from "@/shared/ui/text-context-menu";

/** Menu commands use CodeMirror transactions, including its existing multi-selection history. */
export function registerPromptContextMenu(view: EditorView) {
  return registerTextEditor(view.dom, () => {
    const state = view.state;
    const disabled =
      view.contentDOM.getAttribute("aria-disabled") === "true" ||
      Boolean(view.dom.closest("[inert]"));
    const mutable = !disabled && !state.readOnly;
    const selected = state.selection.ranges.some((range) => !range.empty);

    const restore = () => {
      if (!view.dom.isConnected) return;
      if (view.state.doc === state.doc) view.dispatch({ selection: state.selection });
      view.focus();
    };

    return {
      element: view.contentDOM,
      restore,
      enabled: {
        undo: mutable && undoDepth(state) > 0,
        redo: mutable && redoDepth(state) > 0,
        cut: mutable && selected,
        copy: !disabled && selected,
        paste: mutable && Boolean(navigator.clipboard?.readText),
        selectAll: !disabled && state.doc.length > 0,
      },
      run: async (action) => {
        if (
          !view.dom.isConnected ||
          view.contentDOM.getAttribute("aria-disabled") === "true" ||
          view.dom.closest("[inert]")
        )
          return;
        if (["undo", "redo", "cut", "paste"].includes(action) && view.state.readOnly) return;
        restore();
        if (action === "undo") {
          undo(view);
          return;
        }
        if (action === "redo") {
          redo(view);
          return;
        }
        if (action === "selectAll") {
          selectAll(view);
          return;
        }
        if (view.state.doc !== state.doc) return;
        if (action === "copy" || action === "cut") {
          await navigator.clipboard.writeText(
            state.selection.ranges
              .map((range) => state.sliceDoc(range.from, range.to))
              .join(state.lineBreak),
          );
          if (
            action === "copy" ||
            !view.dom.isConnected ||
            !view.hasFocus ||
            view.state.doc !== state.doc ||
            !view.state.selection.eq(state.selection) ||
            view.state.readOnly ||
            view.contentDOM.getAttribute("aria-disabled") === "true"
          )
            return;
          restore();
          view.dispatch({
            ...view.state.replaceSelection(""),
            annotations: Transaction.userEvent.of("delete.cut"),
          });
        } else {
          const text = await navigator.clipboard.readText();
          if (
            !view.dom.isConnected ||
            !view.hasFocus ||
            view.state.doc !== state.doc ||
            !view.state.selection.eq(state.selection) ||
            view.state.readOnly ||
            view.contentDOM.getAttribute("aria-disabled") === "true"
          )
            return;
          restore();
          view.dispatch({
            ...view.state.replaceSelection(text),
            annotations: Transaction.userEvent.of("input.paste"),
            scrollIntoView: true,
          });
        }
      },
    };
  });
}

import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { formattingTransaction } from "./editor-format";

describe("prompt formatting transaction", () => {
  it("maps multiple selections and keeps formatting as one separate undo step", () => {
    let state = EditorState.create({
      doc: "a ,b,c",
      selection: EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(6)]),
      extensions: [history(), EditorState.allowMultipleSelections.of(true)],
    });
    state = state.update({ changes: { from: 6, insert: "d" } }).state;
    const before = state;
    state = state.update(
      formattingTransaction({
        text: "a, b, cd",
        changes: [
          { from: 1, to: 2, insert: "" },
          { from: 3, to: 3, insert: " " },
          { from: 5, to: 5, insert: " " },
        ],
      }),
    ).state;
    expect(state.doc.toString()).toBe("a, b, cd");
    expect(state.selection.ranges.map((range) => range.head)).toEqual([4, 7]);
    const target = {
      get state() {
        return state;
      },
      dispatch: (transaction: { state: EditorState }) => {
        state = transaction.state;
      },
    };
    expect(undo(target)).toBe(true);
    expect(state.doc.toString()).toBe(before.doc.toString());
    expect(state.selection.eq(before.selection)).toBe(true);
    expect(redo(target)).toBe(true);
    expect(state.doc.toString()).toBe("a, b, cd");
    expect(undo(target)).toBe(true);
    expect(undo(target)).toBe(true);
    expect(state.doc.toString()).toBe("a ,b,c");
  });
});

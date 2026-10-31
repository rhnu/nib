import { history, isolateHistory, undo } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { completionInsertion } from "./editor-completion";

describe("completion insertion", () => {
  it.each([
    ["blu", "blue eyes, "],
    ["blu,green hair", "blue eyes, green hair"],
    ["blu  ,  green hair", "blue eyes, green hair"],
    ["blu\t ", "blue eyes, "],
    ["blu\ngreen hair", "blue eyes, \ngreen hair"],
    ["blu}", "blue eyes, }"],
  ])("separates the completed tag in %j", (source, expected) => {
    const state = EditorState.create({ doc: source });
    const completed = state.update(
      completionInsertion(state, { from: 0, to: 3 }, "blue eyes"),
    ).state;
    expect(completed.doc.toString()).toBe(expected);
    expect(completed.sliceDoc(0, completed.selection.main.head)).toBe("blue eyes, ");
  });

  it("replaces the whole tag inside weighted syntax and undoes the separator together", () => {
    const source = "😀, {blu, green hair}";
    let state = EditorState.create({ doc: source, extensions: history() });
    state = state.update({
      ...completionInsertion(state, { from: 5, to: 8 }, "blue eyes"),
      annotations: [Transaction.userEvent.of("input.complete"), isolateHistory.of("full")],
    }).state;
    expect(state.doc.toString()).toBe("😀, {blue eyes, green hair}");
    expect(state.sliceDoc(state.selection.main.head)).toBe("green hair}");
    expect(
      undo({
        state,
        dispatch: (transaction) => {
          state = transaction.state;
        },
      }),
    ).toBe(true);
    expect(state.doc.toString()).toBe(source);
  });
});

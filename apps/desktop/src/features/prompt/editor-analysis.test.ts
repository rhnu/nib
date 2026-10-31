import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { PromptDocument } from "@/bindings/prompt";
import {
  promptAnalysis,
  promptContext,
  promptPending,
  promptRevision,
  setPromptAnalysis,
  setPromptContext,
  setPromptPending,
} from "./editor-analysis";

const document: PromptDocument = {
  text: "blue",
  analysis: { spans: [], tokens: [], diagnostics: [] },
  sourceMap: [],
  comments: [],
  sourceDiagnostics: [],
  completionRanges: [{ from: 0, to: 4 }],
  valid: true,
};

describe("current prompt semantics", () => {
  const initial = () =>
    EditorState.create({
      doc: "blue",
      extensions: [promptContext, promptAnalysis, promptPending],
    }).update({
      effects: [setPromptContext.of("model-a/editable"), setPromptAnalysis.of(document)],
    }).state;

  it("removes actionable source coordinates immediately when an edit begins", () => {
    const edited = initial().update({ changes: { from: 0, to: 0, insert: "dark " } }).state;
    expect(edited.field(promptAnalysis)).toBeNull();
    expect(edited.field(promptPending)).toBe(true);
    const completed = edited.update({ effects: setPromptPending.of(false) }).state;
    expect(completed.field(promptPending)).toBe(false);
    expect(completed.field(promptAnalysis)).toBeNull();
  });

  it("invalidates semantics on a context switch without requiring a text edit", () => {
    const switched = initial().update({ effects: setPromptContext.of("model-b/literal") }).state;
    expect(switched.doc.toString()).toBe("blue");
    expect(switched.field(promptAnalysis)).toBeNull();
    const analyzed = switched.update({ effects: setPromptAnalysis.of(document) }).state;
    expect(analyzed.field(promptAnalysis)?.completionRanges).toEqual([{ from: 0, to: 4 }]);
  });
});

describe("prompt lookup revision", () => {
  it("invalidates an earlier lookup when the cursor moves away and comes back", () => {
    const initial = EditorState.create({
      doc: "blue",
      selection: { anchor: 4 },
      extensions: [promptRevision],
    });
    const moved = initial.update({ selection: { anchor: 0 } }).state;
    const restored = moved.update({ selection: { anchor: 4 } }).state;
    expect(restored.selection.eq(initial.selection)).toBe(true);
    expect(restored.field(promptRevision)).not.toBe(initial.field(promptRevision));
  });

  it("invalidates an earlier lookup after editing and restoring the same text", () => {
    const initial = EditorState.create({ doc: "blue", extensions: [promptRevision] });
    const edited = initial.update({ changes: { from: 0, to: 4, insert: "red" } }).state;
    const restored = edited.update({ changes: { from: 0, to: 3, insert: "blue" } }).state;
    expect(restored.doc.toString()).toBe(initial.doc.toString());
    expect(restored.field(promptRevision)).not.toBe(initial.field(promptRevision));
  });
});

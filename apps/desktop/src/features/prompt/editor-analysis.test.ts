import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { promptRevision } from "./editor-analysis";

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

import { describe, expect, it } from "vitest";
import { editPngTextEntry, pngTextSession, storePngTextSession } from "./model";

describe("PNG text drafts", () => {
  it("starts with explicit changes only and keeps other image drafts when saving", () => {
    const original = {
      sessions: [
        {
          assetId: "first",
          entries: [{ keyword: "Title", text: "old" }],
          selectedOutputAssetId: "out",
        },
      ],
    };
    const session = pngTextSession(original, "second");
    expect(session.entries).toEqual([]);
    const next = storePngTextSession(original, {
      ...session,
      entries: [{ keyword: "Comment", text: "" }],
    });
    expect(pngTextSession(next, "first")).toEqual(original.sessions[0]);
    expect(pngTextSession(next, "second").entries).toEqual([{ keyword: "Comment", text: "" }]);
    expect(original.sessions).toHaveLength(1);
  });

  it("opening a duplicate original keyword keeps its existing edited replacement", () => {
    const entries = [{ keyword: "Comment", text: "my edit" }];
    expect(editPngTextEntry(entries, { keyword: "COMMENT", text: "source duplicate" })).toEqual({
      entries,
      index: 0,
    });
  });

  it("uses the SDK's ASCII matching without folding Latin-1 keyword characters", () => {
    const entries = [{ keyword: "Étitle", text: "first" }];
    expect(editPngTextEntry(entries, { keyword: "étitle", text: "second" }).entries).toHaveLength(
      2,
    );
  });
});

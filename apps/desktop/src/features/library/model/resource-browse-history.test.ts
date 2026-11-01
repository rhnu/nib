import { describe, expect, it } from "vitest";
import {
  createResourceBrowseHistory,
  createResourceBrowseState,
  moveResourceBrowseHistory,
  pruneResourceBrowseHistory,
  pushResourceBrowseHistory,
} from "./resource-browse-history";

describe("resource browsing history", () => {
  it("restores the complete search and pagination state", () => {
    const root = createResourceBrowseState();
    const filtered = createResourceBrowseState({
      folderId: "portraits",
      query: "night",
      kind: "chunk",
      model: "nai",
      tag: "favorite",
      sort: "updatedAt",
      descending: true,
      offset: 60,
    });
    const history = pushResourceBrowseHistory(createResourceBrowseHistory(root), filtered);
    const previous = moveResourceBrowseHistory(history, "back");
    expect(previous.entries[previous.index]).toEqual(root);
    const next = moveResourceBrowseHistory(previous, "forward");
    expect(next.entries[next.index]).toEqual(filtered);
  });

  it("truncates only the abandoned forward branch and ignores unchanged destinations", () => {
    const initial = createResourceBrowseHistory(createResourceBrowseState());
    const first = pushResourceBrowseHistory(
      initial,
      createResourceBrowseState({ folderId: "first" }),
    );
    const second = pushResourceBrowseHistory(
      first,
      createResourceBrowseState({ folderId: "second" }),
    );
    const back = moveResourceBrowseHistory(second, "back");
    const filtered = pushResourceBrowseHistory(
      back,
      createResourceBrowseState({ folderId: "first", query: "search" }),
    );
    expect(filtered.entries.map((entry) => entry.folderId)).toEqual([null, "first", "second"]);
    const branch = pushResourceBrowseHistory(
      filtered,
      createResourceBrowseState({ folderId: "branch" }),
    );
    expect(branch.entries.map((entry) => entry.folderId)).toEqual([null, "first", "branch"]);
    expect(moveResourceBrowseHistory(branch, "forward")).toBe(branch);
    expect(pushResourceBrowseHistory(branch, branch.entries[branch.index])).toBe(branch);
    expect(moveResourceBrowseHistory(initial, "back")).toBe(initial);
  });

  it("updates search, filters, sorting and pagination in the current directory visit", () => {
    let history = createResourceBrowseHistory(createResourceBrowseState());
    history = pushResourceBrowseHistory(history, createResourceBrowseState({ query: "p" }));
    history = pushResourceBrowseHistory(
      history,
      createResourceBrowseState({ query: "portrait", tag: "night", offset: 60 }),
    );
    expect(history.entries).toHaveLength(1);
    history = pushResourceBrowseHistory(
      history,
      createResourceBrowseState({ folderId: "characters" }),
    );
    const previous = moveResourceBrowseHistory(history, "back");
    expect(previous.entries[previous.index]).toMatchObject({
      folderId: null,
      query: "portrait",
      tag: "night",
      offset: 60,
    });
  });

  it("removes deleted folders from both directions while retaining the current entry", () => {
    let history = createResourceBrowseHistory(createResourceBrowseState());
    for (const folderId of ["deleted-before", "current", "deleted-after", "kept"])
      history = pushResourceBrowseHistory(history, createResourceBrowseState({ folderId }));
    history = moveResourceBrowseHistory(moveResourceBrowseHistory(history, "back"), "back");
    const pruned = pruneResourceBrowseHistory(history, new Set(["current", "kept"]));
    expect(pruned.entries.map((entry) => entry.folderId)).toEqual([null, "current", "kept"]);
    expect(pruned.index).toBe(1);
    expect(pruned.entries[moveResourceBrowseHistory(pruned, "forward").index].folderId).toBe(
      "kept",
    );
  });

  it("returns a deleted current folder to root without losing search filters", () => {
    const initial = createResourceBrowseHistory(createResourceBrowseState());
    const history = pushResourceBrowseHistory(
      initial,
      createResourceBrowseState({
        folderId: "deleted",
        query: "portrait",
        tag: "night",
        offset: 90,
      }),
    );
    const pruned = pruneResourceBrowseHistory(history, new Set());
    expect(pruned.entries[pruned.index]).toMatchObject({
      folderId: null,
      query: "portrait",
      tag: "night",
      offset: 0,
    });
    expect(pruneResourceBrowseHistory(pruned, new Set())).toBe(pruned);
  });

  it("keeps independent browser sessions separate", () => {
    const main = pushResourceBrowseHistory(
      createResourceBrowseHistory(createResourceBrowseState()),
      createResourceBrowseState({ folderId: "main" }),
    );
    const picker = createResourceBrowseHistory(createResourceBrowseState({ kind: "chunk" }));
    expect(picker.entries).toHaveLength(1);
    expect(picker.entries[0].folderId).toBeNull();
    expect(main.entries[main.index].folderId).toBe("main");
  });
});

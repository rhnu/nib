import { describe, expect, it, vi } from "vitest";
import type { Resource } from "@/bindings/workbench";
import {
  acceptLibrarySave,
  createLibrarySessionStore,
  editLibraryResource,
  filterLibraryResources,
  completeLibraryPaste,
  dismissLibraryResource,
  runLibraryOperation,
  moveLibraryHistory,
  pruneLibraryHistory,
} from "./library-session";

const resource = (text: string): Resource => ({
  id: "chunk",
  description: "",
  aliases: [],
  tags: [],
  models: [],
  folderId: null,
  coverAssetId: null,
  createdAt: 0,
  updatedAt: 0,
  name: "Chunk",
  content: { kind: "chunk", text },
});

describe("library session navigation", () => {
  it("retains direct pagination writes in a directory visit and restores without adding a destination", () => {
    const store = createLibrarySessionStore();
    filterLibraryResources(store, { query: "portrait", tag: "night" });
    store.setState({ offset: 60, selectedIds: ["selected"] });
    filterLibraryResources(store, { folderId: "folder" });
    const entries = store.getState().browseHistory.entries;
    const folders = [{ id: "folder", name: "Folder", parentId: null, createdAt: 0, updatedAt: 0 }];
    moveLibraryHistory(store, "back", folders);
    expect(store.getState()).toMatchObject({
      query: "portrait",
      tag: "night",
      offset: 60,
      selectedIds: [],
    });
    expect(store.getState().browseHistory.entries).toBe(entries);
    moveLibraryHistory(store, "forward", folders);
    expect(store.getState()).toMatchObject({ folderId: "folder", offset: 0 });
    expect(store.getState().browseHistory.entries).toBe(entries);
  });

  it("does not dismiss or navigate through an editor, a pending operation, or a confirmation", () => {
    const store = createLibrarySessionStore();
    filterLibraryResources(store, { query: "portrait", folderId: "folder" });
    const index = store.getState().browseHistory.index;
    store.setState({ editor: resource("unsaved"), dirty: true });
    moveLibraryHistory(store, "back", []);
    expect(store.getState()).toMatchObject({ editor: resource("unsaved"), dirty: true });
    store.setState({ editor: null, busy: true });
    moveLibraryHistory(store, "back", []);
    store.setState({ busy: false, confirm: { title: "confirm", action: () => {} } });
    moveLibraryHistory(store, "back", []);
    expect(store.getState().browseHistory.index).toBe(index);
    expect(store.getState().query).toBe("portrait");
  });

  it("cleans a removed current folder and selection without recording another entry", () => {
    const store = createLibrarySessionStore();
    filterLibraryResources(store, { folderId: "removed", tag: "night" });
    store.setState({ offset: 60, selectedIds: ["old"] });
    pruneLibraryHistory(store, []);
    expect(store.getState()).toMatchObject({
      folderId: null,
      tag: "night",
      offset: 0,
      selectedIds: [],
    });
    expect(store.getState().browseHistory.entries.every((entry) => entry.folderId === null)).toBe(
      true,
    );
  });
});

describe("library session edits", () => {
  it("returns to the original browser context on save while holding busy until refresh completes", () => {
    const store = createLibrarySessionStore();
    store.setState({
      editor: resource("submitted"),
      dirty: true,
      busy: true,
      folderId: "portraits",
      query: "portrait",
      tag: "night",
      offset: 60,
      operation: 4,
    });
    acceptLibrarySave(store, { id: "chunk", version: 0 }, resource("submitted"));
    expect(store.getState()).toMatchObject({
      editor: null,
      dirty: false,
      busy: true,
      folderId: "portraits",
      query: "portrait",
      tag: "night",
      offset: 60,
      operation: 4,
      selectedIds: ["chunk"],
    });
  });
  it("consumes only the cut buffer used by a completed paste", () => {
    const store = createLibrarySessionStore();
    const first = { resources: ["first"], folders: [] };
    const second = { resources: ["second"], folders: [] };
    store.setState({ clipboard: { selection: first, cut: true } });
    completeLibraryPaste(store, second);
    expect(store.getState().clipboard?.selection).toBe(first);
    store.setState({ clipboard: { selection: second, cut: true } });
    completeLibraryPaste(store, first);
    expect(store.getState().clipboard?.selection).toBe(second);
    completeLibraryPaste(store, second);
    expect(store.getState().clipboard).toBeNull();
  });
  it("resets the page and selection when navigating folders or changing a filter, preserving the editor", () => {
    const store = createLibrarySessionStore();
    const editor = resource("unsaved content");
    store.setState({ editor, dirty: true, offset: 120, selectedIds: ["old"], query: "portrait" });
    filterLibraryResources(store, { folderId: "characters" });
    expect(store.getState()).toMatchObject({
      folderId: "characters",
      offset: 0,
      selectedIds: [],
      query: "portrait",
      editor,
      dirty: true,
    });
    store.setState({ offset: 60, selectedIds: ["another"] });
    filterLibraryResources(store, { tag: "night" });
    expect(store.getState()).toMatchObject({
      tag: "night",
      offset: 0,
      selectedIds: [],
      editor,
      dirty: true,
    });
  });
  it("keeps search, selection and later edits while a detached consumer's save completes", () => {
    const store = createLibrarySessionStore();
    store.setState({ editor: resource("original"), query: "portrait", kind: "chunk" });
    const unsubscribe = store.subscribe(vi.fn());
    editLibraryResource(store, resource("submitted"));
    const request = { id: "chunk", version: store.getState().version };
    unsubscribe();

    editLibraryResource(store, resource("edited during save"));
    acceptLibrarySave(store, request, resource("submitted"));

    expect(store.getState()).toMatchObject({
      query: "portrait",
      kind: "chunk",
      editor: resource("edited during save"),
      saveMode: "update",
      dirty: true,
    });
    acceptLibrarySave(
      store,
      { id: "chunk", version: store.getState().version },
      resource("edited during save"),
    );
    expect(store.getState()).toMatchObject({
      editor: null,
      dirty: false,
      selectedIds: ["chunk"],
    });
  });

  it("ignores edits and save responses belonging to a previous selection", () => {
    const store = createLibrarySessionStore();
    const selected = { ...resource("selected"), id: "other" };
    store.setState({ editor: selected });
    editLibraryResource(store, resource("stale"));
    acceptLibrarySave(store, { id: "chunk", version: 0 }, resource("stale"));
    expect(store.getState()).toMatchObject({ editor: selected, dirty: false });
    editLibraryResource(store, {
      ...selected,
      content: { kind: "chunk", text: "new" },
    });
    expect(store.getState().editor).toMatchObject({
      content: { kind: "chunk", text: "new" },
    });
  });

  it("blocks another action until the deleted editor's operation finishes refreshing", async () => {
    const store = createLibrarySessionStore();
    store.setState({ editor: resource("deleted"), saveMode: "update", dirty: true });
    let finishRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => {
      finishRefresh = resolve;
    });
    const deleting = runLibraryOperation(store, async () => {
      dismissLibraryResource(store);
      await refresh;
    });
    expect(store.getState()).toMatchObject({ editor: null, dirty: false, busy: true });
    const next = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await runLibraryOperation(store, next);
    expect(next).not.toHaveBeenCalled();
    finishRefresh();
    await deleting;
    expect(store.getState().busy).toBe(false);
    await runLibraryOperation(store, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("retains an operation failure and releases the session for retry", async () => {
    const store = createLibrarySessionStore();
    const failure = new Error("refresh failed");
    await runLibraryOperation(store, async () => {
      throw failure;
    });
    expect(store.getState()).toMatchObject({ busy: false, error: failure });
    const retry = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await runLibraryOperation(store, retry);
    expect(retry).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({ busy: false, error: "" });
  });
});

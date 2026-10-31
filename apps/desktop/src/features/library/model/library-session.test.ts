import { describe, expect, it, vi } from "vitest";
import type { Resource } from "@/bindings/workbench";
import {
  acceptLibrarySave,
  createLibrarySessionStore,
  editLibraryResource,
  filterLibraryResources,
  completeLibraryPaste,
} from "./library-session";

const resource = (text: string, revision = 1): Resource => ({
  id: "chunk",
  revision,
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

describe("library session edits", () => {
  it("consumes only the cut buffer used by a completed paste", () => {
    const store = createLibrarySessionStore();
    const first = { resources: [{ id: "first", revision: 1 }], folders: [] };
    const second = { resources: [{ id: "second", revision: 1 }], folders: [] };
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
    acceptLibrarySave(store, request, resource("submitted", 2));

    expect(store.getState()).toMatchObject({
      query: "portrait",
      kind: "chunk",
      editor: resource("edited during save", 2),
      dirty: true,
    });
    acceptLibrarySave(
      store,
      { id: "chunk", version: store.getState().version },
      resource("edited during save", 3),
    );
    expect(store.getState()).toMatchObject({
      editor: resource("edited during save", 3),
      dirty: false,
    });
  });

  it("ignores edits and save responses belonging to a previous selection", () => {
    const store = createLibrarySessionStore();
    const selected = { ...resource("selected", 4), id: "other" };
    store.setState({ editor: selected });
    editLibraryResource(store, resource("stale"));
    acceptLibrarySave(store, { id: "chunk", version: 0 }, resource("stale", 5));
    expect(store.getState()).toMatchObject({ editor: selected, dirty: false });
    editLibraryResource(store, {
      ...selected,
      revision: 0,
      content: { kind: "chunk", text: "new" },
    });
    expect(store.getState().editor).toMatchObject({
      revision: 4,
      content: { kind: "chunk", text: "new" },
    });
  });
});

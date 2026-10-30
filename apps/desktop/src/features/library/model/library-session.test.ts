import { describe, expect, it, vi } from "vitest";
import type { Resource } from "@/bindings/workbench";
import {
  acceptLibrarySave,
  createLibrarySessionStore,
  editLibraryResource,
} from "./library-session";

const resource = (text: string, revision = 1): Resource => ({
  id: "chunk",
  revision,
  name: "Chunk",
  content: { kind: "chunk", text },
});

describe("library session edits", () => {
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

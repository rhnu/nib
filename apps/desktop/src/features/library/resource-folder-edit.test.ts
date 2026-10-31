import { describe, expect, it } from "vitest";
import type { ResourceFolder } from "@/bindings/workbench";
import { resourceFolderEdit } from "./resource-folder-edit";

const folder: ResourceFolder = {
  id: "folder",
  name: "Original",
  parentId: "old-parent",
  createdAt: 10,
  updatedAt: 20,
};

describe("folder edit intent", () => {
  it("creates a folder with its chosen name and parent", () => {
    expect(resourceFolderEdit(null, { ...folder, name: " New " })).toEqual({
      kind: "create",
      id: folder.id,
      name: "New",
      parentId: folder.parentId,
    });
  });

  it("renames without submitting the parent from an old display snapshot", () => {
    expect(resourceFolderEdit(folder, { ...folder, name: "Renamed" })).toEqual({
      kind: "update",
      id: folder.id,
      changes: [{ kind: "name", name: "Renamed" }],
    });
  });

  it("moves to the root without submitting an unchanged name", () => {
    expect(resourceFolderEdit(folder, { ...folder, parentId: null })).toEqual({
      kind: "update",
      id: folder.id,
      changes: [{ kind: "parent", parentId: null }],
    });
  });

  it("includes both deliberate changes in one edit", () => {
    expect(
      resourceFolderEdit(folder, { ...folder, name: "Renamed", parentId: "new-parent" }),
    ).toEqual({
      kind: "update",
      id: folder.id,
      changes: [
        { kind: "name", name: "Renamed" },
        { kind: "parent", parentId: "new-parent" },
      ],
    });
  });

  it("does not write fields that were left unchanged or reverted", () => {
    expect(resourceFolderEdit(folder, { ...folder, name: " Original " })).toEqual({
      kind: "update",
      id: folder.id,
      changes: [],
    });
  });
});

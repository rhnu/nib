import { describe, expect, it } from "vitest";
import type { ResourceFolder } from "@/bindings/workbench";
import { destinationFolders, folderAncestry, resourceLocationQuery } from "./resource-location";

const folder = (id: string, parentId: string | null): ResourceFolder => ({
  id,
  parentId,
  name: id,
  createdAt: 0,
  updatedAt: 0,
});

describe("resource directory navigation", () => {
  it("browses direct contents and expands the current subtree only for a text search", () => {
    expect(resourceLocationQuery(null, "")).toEqual({
      folderId: null,
      rootOnly: true,
      includeSubfolders: false,
    });
    expect(resourceLocationQuery("characters", "  ")).toEqual({
      folderId: "characters",
      rootOnly: false,
      includeSubfolders: false,
    });
    expect(resourceLocationQuery(null, "portrait")).toEqual({
      folderId: null,
      rootOnly: false,
      includeSubfolders: true,
    });
    expect(resourceLocationQuery("characters", "portrait")).toEqual({
      folderId: "characters",
      rootOnly: false,
      includeSubfolders: true,
    });
  });

  it("resolves every ancestor and keeps existing paths deeper than the creation limit accessible", () => {
    const folders = Array.from({ length: 10 }, (_, index) =>
      folder(`${index}`, index ? `${index - 1}` : null),
    );
    expect(folderAncestry("9", folders).map(({ id }) => id)).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
    expect(folderAncestry(null, folders)).toEqual([]);
  });

  it("hides selected trees from destination choices while retaining siblings and ancestors", () => {
    const folders = [
      folder("root", null),
      folder("selected", "root"),
      folder("child", "selected"),
      folder("sibling", "root"),
    ];
    expect(destinationFolders(folders, ["selected"]).map(({ id }) => id)).toEqual([
      "root",
      "sibling",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import type { Resource } from "@/bindings/workbench";
import { mergeResourceSave, splitLabels } from "./resource-edit";

const resource = (text: string, revision = 0): Resource => ({
  id: "resource",
  description: "",
  aliases: [],
  tags: [],
  models: [],
  folderId: null,
  coverAssetId: null,
  createdAt: 0,
  updatedAt: 0,
  name: "Name",
  revision,
  content: { kind: "chunk", text },
});

describe("resource save acknowledgements", () => {
  it("adopts an independently copied cover while retaining edits made during save", () => {
    const latest = { ...resource("later content", 1), coverAssetId: "source-image" };
    const saved = {
      ...resource("submitted", 2),
      coverAssetId: "owned-cover",
      createdAt: 10,
      updatedAt: 20,
    };
    expect(
      mergeResourceSave(
        latest,
        4,
        { id: "resource", version: 3, coverAssetId: "source-image" },
        saved,
      ),
    ).toEqual({
      editor: { ...latest, revision: 2, coverAssetId: "owned-cover", createdAt: 10, updatedAt: 20 },
      dirty: true,
    });
  });
  it("retains a later cover choice when the submitted cover was copied", () => {
    const latest = { ...resource("later content", 1), coverAssetId: "later-image" };
    const saved = { ...resource("submitted", 2), coverAssetId: "owned-cover" };
    expect(
      mergeResourceSave(
        latest,
        4,
        { id: "resource", version: 3, coverAssetId: "source-image" },
        saved,
      )?.editor.coverAssetId,
    ).toBe("later-image");
  });
  it("accepts the host result when the exact submitted editor version is still current", () => {
    const saved = resource("submitted", 2);
    expect(
      mergeResourceSave(resource("submitted", 1), 3, { id: "resource", version: 3 }, saved),
    ).toEqual({ editor: saved, dirty: false });
  });
  it("keeps content added during an in-flight save and merges only its revision", () => {
    const latest = resource("later edit", 1);
    expect(
      mergeResourceSave(latest, 4, { id: "resource", version: 3 }, resource("submitted", 2)),
    ).toEqual({ editor: { ...latest, revision: 2 }, dirty: true });
    expect(latest.revision).toBe(1);
  });
  it("does not reopen a dismissed resource or replace a different selection", () => {
    const request = { id: "resource", version: 1 };
    expect(mergeResourceSave(null, 2, request, resource("saved", 1))).toBeNull();
    expect(
      mergeResourceSave({ ...resource("other"), id: "other" }, 2, request, resource("saved", 1)),
    ).toBeNull();
  });
});

describe("resource labels", () => {
  it("accepts comma and newline separated labels without retaining empty or duplicate entries", () => {
    expect(splitLabels(" portrait,  sky，portrait\n night , , sky ")).toEqual([
      "portrait",
      "sky",
      "night",
    ]);
    expect(splitLabels(" ,，\n ")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { Resource } from "@/bindings/workbench";
import { mergeResourceSave, splitLabels } from "./resource-edit";

const resource = (text: string): Resource => ({
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
  content: { kind: "chunk", text },
});

describe("resource save acknowledgements", () => {
  it("adopts an independently copied cover while retaining edits made during save", () => {
    const latest = { ...resource("later content"), coverAssetId: "source-image" };
    const saved = {
      ...resource("submitted"),
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
      editor: { ...latest, coverAssetId: "owned-cover", createdAt: 10, updatedAt: 20 },
      dirty: true,
    });
  });
  it("retains a later cover choice when the submitted cover was copied", () => {
    const latest = { ...resource("later content"), coverAssetId: "later-image" };
    const saved = { ...resource("submitted"), coverAssetId: "owned-cover" };
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
    const saved = resource("submitted");
    expect(
      mergeResourceSave(resource("submitted"), 3, { id: "resource", version: 3 }, saved),
    ).toEqual({ editor: saved, dirty: false });
  });
  it("does not reopen a dismissed resource or replace a different selection", () => {
    const request = { id: "resource", version: 1 };
    expect(mergeResourceSave(null, 2, request, resource("saved"))).toBeNull();
    expect(
      mergeResourceSave({ ...resource("other"), id: "other" }, 2, request, resource("saved")),
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

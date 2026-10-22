import { describe, expect, it } from "vitest";
import { imageUnavailableReason, singleImageFile } from "./model";

describe("single source-image import", () => {
  it("treats cancelling the file picker as no selection", () => {
    expect(singleImageFile([])).toEqual({ file: null, error: null });
  });
  it("keeps the one selected file", () => {
    const file = { name: "image.png" };
    expect(singleImageFile([file])).toEqual({ file, error: null });
  });
  it("rejects all files when a single-image target receives more than one", () => {
    const selection = singleImageFile([{ name: "first.png" }, { name: "second.png" }]);
    expect(selection.file).toBeNull();
    expect(selection.error).toBeTruthy();
  });
});

describe("image availability", () => {
  it("rejects a missing image and a Vibe that happens to have readable bytes", () => {
    expect(imageUnavailableReason({ kind: "image", available: false })).not.toBeNull();
    expect(imageUnavailableReason({ kind: "vibe", available: true })).not.toBeNull();
    expect(imageUnavailableReason({ kind: "vibeDocument", available: true })).not.toBeNull();
  });
  it("allows a retained image", () => {
    expect(imageUnavailableReason({ kind: "image", available: true })).toBeNull();
  });
});

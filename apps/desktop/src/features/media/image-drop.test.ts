import { describe, expect, it } from "vitest";
import { acceptsImageDrop, droppedImage, remoteImageUrl } from "./image-drop";

const transfer = (uri: string, plain = "") => ({
  files: [] as File[],
  getData: (type: string) => (type === "text/uri-list" ? uri : type === "text/plain" ? plain : ""),
});

describe("image drag payloads", () => {
  it("accepts local and browser image payloads without capturing internal prompt or text moves", () => {
    expect(acceptsImageDrop(["Files"])).toBe(true);
    expect(acceptsImageDrop(["text/html", "text/uri-list"])).toBe(true);
    expect(acceptsImageDrop(["application/x-nib-prompt"])).toBe(false);
    expect(acceptsImageDrop(["text/plain"])).toBe(false);
  });
  it("reads a single image address and rejects multiple URLs and local file URLs", () => {
    expect(droppedImage(transfer("# image\r\nhttps://images.example/a.png\r\n"))).toEqual({
      kind: "url",
      url: "https://images.example/a.png",
    });
    expect(droppedImage(transfer("https://example/a.png\nhttps://example/b.png"))).toBeNull();
    expect(droppedImage(transfer("file:///C:/private.png"))).toBeNull();
    expect(remoteImageUrl("https://user:secret@example.com/image.png")).toBe(false);
  });
  it("prefers dropped file bytes over a companion URL and rejects multiple files", () => {
    const file = { name: "original.png" } as File;
    expect(droppedImage({ ...transfer("https://example/a.png"), files: [file] })).toEqual({
      kind: "file",
      file,
    });
    expect(droppedImage({ ...transfer("https://example/a.png"), files: [file, file] })).toBeNull();
  });
});

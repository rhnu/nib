/** Drag payloads contain only files or image addresses; HTML is never inserted into the page. */
export type DroppedImage = { kind: "file"; file: File } | { kind: "url"; url: string };

export function acceptsImageDrop(types: readonly string[]): boolean {
  return ["Files", "text/uri-list", "text/html"].some((type) => types.includes(type));
}

export function droppedImage(data: {
  files: ArrayLike<File>;
  getData: (type: string) => string;
}): DroppedImage | null {
  if (data.files.length > 1) return null;
  if (data.files.length === 1) return { kind: "file", file: data.files[0]! };
  // Browsers may include a containing page's URL alongside the actual dragged image.
  const html = data.getData("text/html");
  if (html) {
    const images = new DOMParser().parseFromString(html, "text/html").querySelectorAll("img");
    if (images.length > 1) return null;
    const source = images[0]?.getAttribute("src");
    if (source && remoteImageUrl(source)) return { kind: "url", url: source };
  }
  const addresses = (data.getData("text/uri-list") || data.getData("text/plain"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  return addresses.length === 1 && remoteImageUrl(addresses[0]!)
    ? { kind: "url", url: addresses[0]! }
    : null;
}

export function remoteImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

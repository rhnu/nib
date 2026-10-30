import type { Resource } from "@/bindings/workbench";

/** A save acknowledges one edit version; later content must survive its response. */
export function mergeResourceSave(
  current: Resource | null,
  version: number,
  request: { id: string; version: number },
  saved: Resource,
): { editor: Resource; dirty: boolean } | null {
  if (!current || current.id !== request.id || saved.id !== request.id) return null;
  return version === request.version
    ? { editor: saved, dirty: false }
    : { editor: { ...current, revision: saved.revision }, dirty: true };
}

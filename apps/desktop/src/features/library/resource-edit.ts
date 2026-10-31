import type { Resource } from "@/bindings/workbench";

/** A save acknowledges one edit version; later content must survive its response. */
export function mergeResourceSave(
  current: Resource | null,
  version: number,
  request: { id: string; version: number; coverAssetId?: string | null },
  saved: Resource,
): { editor: Resource; dirty: boolean } | null {
  if (!current || current.id !== request.id || saved.id !== request.id) return null;
  return version === request.version
    ? { editor: saved, dirty: false }
    : {
        editor: {
          ...current,
          revision: saved.revision,
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
          coverAssetId:
            request.coverAssetId !== undefined && current.coverAssetId === request.coverAssetId
              ? saved.coverAssetId
              : current.coverAssetId,
        },
        dirty: true,
      };
}

/** Normalize human-entered tag and alias lists at the editing boundary. */
export const splitLabels = (value: string) => [
  ...new Set(
    value
      .split(/[,，\n]/)
      .map((value) => value.trim())
      .filter(Boolean),
  ),
];

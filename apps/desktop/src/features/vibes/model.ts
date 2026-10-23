import type { VibeReferenceInput, VibeReferenceOverride } from "../../bindings/workbench";
import type { MediaAsset } from "../../bindings/media";
import { imageName } from "../media/model";

export function vibeMaterialName(asset: MediaAsset): string {
  if (asset.source.kind === "import" && asset.source.name) return imageName(asset);
  const kind =
    asset.kind === "vibeDocument" ? "Vibe 文档" : asset.kind === "image" ? "参考原图" : "Vibe 编码";
  return `${kind} · ${new Date(asset.createdAt).toLocaleString()}`;
}

export type VibeIssues = Record<string, { field: string; message: string }[]>;
export type VibePatch = Partial<Omit<VibeReferenceInput, "id">>;

export function applyVibeOverride(
  value: VibeReferenceInput,
  override?: VibeReferenceOverride,
): VibeReferenceInput {
  return {
    id: value.id,
    enabled: override?.enabled ?? value.enabled,
    input: override?.input ?? value.input,
    strength: override?.strength ?? value.strength,
  };
}

/** Overrides remain attached to source identities through reordering and retain explicit zero/false. */
export function patchVibeOverride(
  values: VibeReferenceOverride[],
  id: string,
  patch: Partial<Omit<VibeReferenceOverride, "id">>,
): VibeReferenceOverride[] {
  const next = {
    id,
    enabled: null,
    input: null,
    strength: null,
    ...values.find((value) => value.id === id),
    ...patch,
  };
  const rest = values.filter((value) => value.id !== id);
  return next.enabled !== null || next.input !== null || next.strength !== null
    ? [...rest, next]
    : rest;
}

export function referenceMode(value: string): boolean | null {
  return value === "inherit" ? null : value === "true";
}

export function downloadBytes(
  bytes: ArrayBuffer,
  filename: string,
  mimeType = "application/json",
): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

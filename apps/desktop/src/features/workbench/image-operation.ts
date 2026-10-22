import type { MediaAsset } from "../../bindings/media";
import type {
  CreationOperation,
  Draft,
  ImageOperationKind,
  ImageOperationOptions,
} from "../../bindings/workbench";
import { invokeHost } from "../../shared/host/invoke";

export type ImageOperationAction = ImageOperationKind;

export const imageOperationApi = {
  create: (id: string, kind: ImageOperationAction) =>
    invokeHost<CreationOperation>("create_image_operation", { id, kind }),
  options: () => invokeHost<ImageOperationOptions>("get_image_operation_options"),
};

export function operationSourceId(operation: CreationOperation): string | null {
  return operation.kind === "textToImage" ? null : operation.assetId;
}

export function imageOperationAction(
  operation: CreationOperation,
): ImageOperationAction | "textToImage" | null {
  if (operation.kind === "imageToImage")
    return operation.maxEnhance ? "maxEnhance" : "imageToImage";
  if (operation.kind === "upscale" || operation.kind === "textToImage") return operation.kind;
  return null;
}

export function operationLabel(operation: CreationOperation): string {
  if (operation.kind === "imageToImage") return operation.maxEnhance ? "Max Enhance" : "图生图";
  if (operation.kind === "upscale") return "独立放大";
  if (operation.kind === "textToImage") return "文生图";
  if (operation.kind === "inpainting") return "局部重绘";
  if (operation.kind === "encodeVibe") return "Vibe 编码";
  return "导演工具";
}

/** Source changes keep edits within the same operation instead of SDK constructor defaults. */
export function applyImageOperation(
  draft: Draft,
  asset: MediaAsset,
  operation: CreationOperation,
): Draft {
  const current = draft.inputs.operation;
  const next =
    current.kind === "imageToImage" && operation.kind === "imageToImage"
      ? { ...current, assetId: asset.id, maxEnhance: operation.maxEnhance }
      : current.kind === "upscale" && operation.kind === "upscale"
        ? { ...current, assetId: asset.id }
        : operation;
  const size =
    next.kind === "imageToImage" && next.maxEnhance && asset.width !== null && asset.height !== null
      ? { width: asset.width, height: asset.height }
      : draft.settings.size;
  return {
    ...draft,
    settings: { ...draft.settings, size },
    inputs: { ...draft.inputs, operation: next },
  };
}

/** The shared request owner asks once when switching would discard an existing operation. */
export function imageOperationNeedsConfirmation(current: Draft, next: Draft): boolean {
  const before = current.inputs.operation;
  const after = next.inputs.operation;
  if (before.kind === "textToImage") return false;
  if (before.kind !== after.kind || operationSourceId(before) !== operationSourceId(after))
    return true;
  if (before.kind === "imageToImage" && after.kind === "imageToImage") {
    return (
      before.strength !== after.strength ||
      before.noise !== after.noise ||
      before.colorCorrect !== after.colorCorrect ||
      before.extraNoiseSeed !== after.extraNoiseSeed ||
      before.addOriginalImage !== after.addOriginalImage ||
      current.settings.size?.width !== next.settings.size?.width ||
      current.settings.size?.height !== next.settings.size?.height
    );
  }
  return JSON.stringify(before) !== JSON.stringify(after);
}

/** Blank optional seeds inherit the generation seed; invalid input never enters persisted state. */
export function optionalImageSeed(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

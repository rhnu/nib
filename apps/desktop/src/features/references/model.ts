import type {
  ModelCapabilities,
  PreciseReferenceInput,
  PreciseReferenceOverride,
} from "@/bindings/workbench";

const availabilityReasons: Record<string, string> = {
  unsupported: "当前模型不支持",
  unsupportedMode: "当前图像操作不支持",
  conflictWithPreciseReference: "与启用的精确参考冲突",
  unavailable: "当前不可用",
};

/** Unsupported empty sections disappear; retained inputs and loading capabilities remain visible. */
export function showPreciseReferences(
  capabilities: Pick<ModelCapabilities, "canAddPreciseReference"> | null,
  count: number,
): boolean {
  return capabilities === null || capabilities.canAddPreciseReference || count > 0;
}

/** NotRequested is an empty intent, so it must never appear as a failed input. */
export function preciseReferenceMessages(
  capabilities: Pick<
    ModelCapabilities,
    "canAddPreciseReference" | "preciseReference" | "vibeReference"
  >,
): { precise: string | null; vibe: string | null } {
  const { preciseReference: precise, vibeReference: vibe } = capabilities;
  return {
    precise:
      !precise.available && precise.reason !== "notRequested"
        ? `精确参考不生效：${availabilityReasons[precise.reason] ?? precise.reason}`
        : !capabilities.canAddPreciseReference
          ? "当前模型或操作不支持精确参考。"
          : null,
    vibe:
      !vibe.available && vibe.reason !== "notRequested"
        ? `氛围转移不生效：${availabilityReasons[vibe.reason] ?? vibe.reason}`
        : null,
  };
}

export type PreciseReferenceField = Exclude<keyof PreciseReferenceInput, "id">;
export type PreciseReferencePatch = Partial<Omit<PreciseReferenceInput, "id">>;
export type PreciseReferenceIssues = Record<string, { field: string; message: string }[]>;

export const preciseReferenceFields = [
  "enabled",
  "assetId",
  "referenceType",
  "strength",
  "fidelity",
  "informationExtracted",
] as const satisfies readonly PreciseReferenceField[];

export function patchPreciseReference(
  values: PreciseReferenceInput[],
  id: string,
  patch: PreciseReferencePatch,
): PreciseReferenceInput[] {
  return values.map((value) => (value.id === id ? { ...value, ...patch } : value));
}

export function emptyPreciseReferenceOverride(id: string): PreciseReferenceOverride {
  return {
    id,
    enabled: null,
    assetId: null,
    referenceType: null,
    strength: null,
    fidelity: null,
    informationExtracted: null,
  };
}

export function applyPreciseReferenceOverride(
  original: PreciseReferenceInput,
  override?: PreciseReferenceOverride,
): PreciseReferenceInput {
  return {
    id: original.id,
    enabled: override?.enabled ?? original.enabled,
    assetId: override?.assetId ?? original.assetId,
    referenceType: override?.referenceType ?? original.referenceType,
    strength: override?.strength ?? original.strength,
    fidelity: override?.fidelity ?? original.fidelity,
    informationExtracted: override?.informationExtracted ?? original.informationExtracted,
  };
}

/** Only the addressed identity changes, including when the original list is reordered. */
export function patchPreciseReferenceOverride(
  overrides: PreciseReferenceOverride[],
  id: string,
  patch: Partial<Omit<PreciseReferenceOverride, "id">>,
): PreciseReferenceOverride[] {
  const next = {
    ...(overrides.find((value) => value.id === id) ?? emptyPreciseReferenceOverride(id)),
    ...patch,
  };
  const remaining = overrides.filter((value) => value.id !== id);
  return preciseReferenceFields.some((field) => next[field] !== null)
    ? [...remaining, next]
    : remaining;
}

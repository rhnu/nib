import { t } from "@/shared/i18n";
import type {
  ModelCapabilities,
  PreciseReferenceInput,
  PreciseReferenceOptions,
  PreciseReferenceOverride,
} from "@/bindings/workbench";

export function newPreciseReferenceType(capabilities: ModelCapabilities | null): string | null {
  return capabilities?.canAddPreciseReference
    ? capabilities.preciseReferenceOptions.defaultReferenceType
    : null;
}

export function preciseReferencePurpose(type: string): string {
  switch (type) {
    case "character_mainoutfit":
      return "character";
    case "character&style_anyoutfit":
      return "character&style";
    default:
      return type;
  }
}

export function preciseReferencePurposes(types: string[]): Map<string, string> {
  const choices = new Map<string, string>();
  for (const type of types) {
    const purpose = preciseReferencePurpose(type);
    if (!choices.has(purpose) || purpose === type) choices.set(purpose, type);
  }
  return choices;
}

/** Returns the stored captions for the off and on states of the same-outfit control. */
export function preciseReferenceOutfitTypes(
  type: string,
  options: Pick<PreciseReferenceOptions, "referenceTypes"> | undefined,
): readonly [off: string, on: string] | null {
  const available = options?.referenceTypes;
  if (!available?.includes(type)) return null;
  const purpose = preciseReferencePurpose(type);
  if (
    purpose === "character" &&
    available.includes("character") &&
    available.includes("character_mainoutfit")
  ) {
    return ["character", "character_mainoutfit"];
  }
  if (
    purpose === "character&style" &&
    available.includes("character&style_anyoutfit") &&
    available.includes("character&style")
  ) {
    return ["character&style_anyoutfit", "character&style"];
  }
  return null;
}

const availabilityReasons: Record<string, string> = {
  get unsupported() {
    return t("references.modelUnsupported");
  },
  get unsupportedMode() {
    return t("references.operationUnsupported");
  },
  get conflictWithPreciseReference() {
    return t("references.preciseReferenceConflict");
  },
  get unavailable() {
    return t("references.unavailable");
  },
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
        ? t("references.preciseReferenceInactive", {
            value0: availabilityReasons[precise.reason] ?? precise.reason,
          })
        : !capabilities.canAddPreciseReference
          ? t("references.preciseReferenceUnsupported")
          : null,
    vibe:
      !vibe.available && vibe.reason !== "notRequested"
        ? t("references.vibeTransferInactive", {
            value0: availabilityReasons[vibe.reason] ?? vibe.reason,
          })
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

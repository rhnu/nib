import type { PreciseReferenceInput } from "@/bindings/workbench";
import { invokeHost } from "@/shared/host/invoke";

export const referenceApi = {
  create: (assetId: string, referenceId: string, referenceType: string) =>
    invokeHost<PreciseReferenceInput>("create_precise_reference", {
      id: assetId,
      referenceId,
      referenceType,
    }),
  importZip: () => invokeHost<PreciseReferenceInput[] | null>("import_precise_reference_zip"),
  exportZip: (references: PreciseReferenceInput[]) =>
    invokeHost<boolean>("export_precise_reference_zip", { references }),
};

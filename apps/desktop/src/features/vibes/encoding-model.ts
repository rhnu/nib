import type { Draft, VibeEncodingInput } from "../../bindings/workbench";
import type { ResultSummary } from "../../bindings/generation";

/** Compare at the IPC's f32 precision, without treating a missing output as reusable. */
export function isReusableEncoding(result: ResultSummary, input: VibeEncodingInput): boolean {
  const saved = result.operation.kind === "encodeVibe" ? result.operation.input : null;
  return (
    result.kind === "vibe" &&
    result.available &&
    saved !== null &&
    saved.assetId === input.assetId &&
    saved.model === input.model &&
    Math.fround(saved.informationExtracted) === Math.fround(input.informationExtracted) &&
    saved.maskAssetId === input.maskAssetId &&
    saved.cropToMask === input.cropToMask &&
    saved.focusSeed === input.focusSeed &&
    saved.infoExtractSeed === input.infoExtractSeed
  );
}

/** Encoding is a separate paid submission; its editor never replaces generation inputs. */
export function encodingSubmission(draft: Draft, input: VibeEncodingInput): Draft {
  return {
    ...draft,
    vibeEncoder: null,
    inputs: { ...draft.inputs, operation: { kind: "encodeVibe", ...input } },
  };
}

export function optionalEncodingSeed(raw: string): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

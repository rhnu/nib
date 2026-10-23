import type { GenerationResult } from "../../../bindings/generation";

export function resultFilename(
  result: Pick<GenerationResult, "jobId" | "sampleIndex" | "mimeType">,
): string {
  const extensions: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };
  const extension = extensions[result.mimeType] ?? "img";
  return `nib-${result.jobId}-${result.sampleIndex + 1}.${extension}`;
}

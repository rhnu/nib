import type {
  FrozenSubmission,
  JobRecord,
  JobSummary,
  GenerationResult,
  ResultSummary,
  OperationSummary,
} from "@/bindings/generation";
import { commandTool, directorToolLabels } from "@/features/director/model";
import { operationSourceId } from "@/features/inputs/image-operation";

export function summarizeOperation(submission: FrozenSubmission): OperationSummary {
  if (submission.kind === "generation")
    return {
      kind: "generation",
      sampleCount: submission.resolved.settings.nSamples,
      sourceAssetId: operationSourceId(submission.resolved.inputs.operation),
    };
  if (submission.kind === "director")
    return { kind: "director", assetId: submission.assetId, tool: commandTool(submission.command) };
  if (submission.kind === "upscale") return { kind: "upscale", assetId: submission.assetId };
  const {
    assetId,
    model,
    informationExtracted,
    maskAssetId,
    cropToMask,
    focusSeed,
    infoExtractSeed,
  } = submission;
  return {
    kind: "encodeVibe",
    input: {
      assetId,
      model,
      informationExtracted,
      maskAssetId,
      cropToMask,
      focusSeed,
      infoExtractSeed,
    },
  };
}

export function summarizeJob(record: JobRecord): JobSummary {
  const { submission, ...summary } = record;
  return { ...summary, operation: summarizeOperation(submission) };
}

export function summarizeResult(record: GenerationResult): ResultSummary {
  const { submission, ...summary } = record;
  return { ...summary, operation: summarizeOperation(submission) };
}

export function operationSummaryLabel(operation: OperationSummary): string {
  if (operation.kind === "generation") return "图像生成";
  if (operation.kind === "director") return directorToolLabels[operation.tool];
  if (operation.kind === "encodeVibe") return `氛围转移编码 · ${operation.input.model}`;
  return "独立放大";
}

/** New head data replaces matching identities, while already loaded older pages remain reachable. */
export function mergeSummaries<T extends { id: string }>(
  newer: readonly T[],
  older: readonly T[],
): T[] {
  const ids = new Set(newer.map((item) => item.id));
  return [...newer, ...older.filter((item) => !ids.has(item.id))];
}

export function reconcileJobs(
  active: readonly JobSummary[],
  head: readonly JobSummary[],
  previous: readonly JobSummary[],
): JobSummary[] {
  return [
    ...active,
    ...mergeSummaries(
      head,
      previous.filter((job) => job.status !== "queued" && job.status !== "running"),
    ).sort((left, right) => right.submittedAt - left.submittedAt),
  ];
}

import type { JobSummary } from "@/bindings/generation";
import type { FeedbackSample } from "../jobs/feedback-state";

type PreviewJob = Pick<JobSummary, "id" | "batchId" | "requestIndex" | "resultIds"> & {
  operation: Pick<JobSummary["operation"], "kind">;
};

/** Follow a later request only after it has a preview frame or a saved image. */
export function nextPreviewJob(
  jobs: readonly PreviewJob[],
  feedback: Readonly<Record<string, readonly Pick<FeedbackSample, "bytes">[]>>,
  batchId: string | null,
  followedJobId: string | null,
): string | null {
  if (!batchId) return null;
  const followed = jobs.find((job) => job.id === followedJobId && job.batchId === batchId);
  let next: PreviewJob | undefined;
  for (const job of jobs) {
    if (
      job.batchId !== batchId ||
      job.operation.kind === "encodeVibe" ||
      job.requestIndex <= (followed?.requestIndex ?? -1) ||
      (next && job.requestIndex <= next.requestIndex)
    )
      continue;
    // A final-received notification contains no displayable image bytes by itself.
    if (job.resultIds.length || feedback[job.id]?.some((sample) => sample.bytes?.byteLength))
      next = job;
  }
  return next?.id ?? null;
}

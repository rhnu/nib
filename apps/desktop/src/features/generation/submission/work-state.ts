import type { JobSummary, JobStatus } from "@/bindings/generation";

export type SubmissionOrigin = "create" | "director";
export type WorkStatus = "idle" | "loading" | "submitting" | "queued" | "running";

export function originForOperation(kind: string): SubmissionOrigin {
  return kind === "director" ? "director" : "create";
}

export function workStatus(
  jobs: readonly Pick<JobSummary, "status" | "operation">[] | null,
  origin: SubmissionOrigin,
  submitting: boolean,
): WorkStatus {
  if (submitting) return "submitting";
  if (jobs === null) return "loading";
  const statuses: JobStatus[] = jobs
    .filter(
      (job) =>
        job.operation.kind !== "encodeVibe" && originForOperation(job.operation.kind) === origin,
    )
    .map((job) => job.status);
  if (statuses.includes("running")) return "running";
  return statuses.includes("queued") ? "queued" : "idle";
}

/** The latest active batch owns the submit row's progress and stop action for this entry. */
export function workBatch(jobs: readonly JobSummary[] | null, origin: SubmissionOrigin) {
  const latest = jobs
    ?.filter(
      (job) =>
        (job.status === "queued" || job.status === "running") &&
        job.operation.kind !== "encodeVibe" &&
        originForOperation(job.operation.kind) === origin,
    )
    .sort(
      (a, b) =>
        b.submittedAt - a.submittedAt || b.id.localeCompare(a.id, undefined, { numeric: true }),
    )[0];
  if (!latest) return null;
  const batch = jobs!.filter((job) => job.batchId === latest.batchId);
  const running = batch.find((job) => job.status === "running");
  const queued = batch.filter((job) => job.status === "queued").length;
  return {
    id: latest.batchId,
    requestCount: latest.requestCount,
    running,
    queued,
    finishing: Boolean(
      running &&
      !queued &&
      batch.some((job) => job.requestIndex > running.requestIndex && job.status === "cancelled"),
    ),
  };
}

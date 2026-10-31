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

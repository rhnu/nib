import type { JobSummary } from "@/bindings/generation";
import { mergeSummaries } from "./summary";

/** A dropped finished event must not hide a previously observed task outside the history head. */
export async function recoverMissingJobs(
  previous: readonly JobSummary[],
  active: readonly JobSummary[],
  history: JobSummary[],
  read: (id: string) => Promise<JobSummary>,
  isCurrent: () => boolean,
): Promise<JobSummary[]> {
  if (!isCurrent()) return history;
  const found = new Set([...active, ...history].map((job) => job.id));
  const missing = previous.filter(
    (job) => (job.status === "queued" || job.status === "running") && !found.has(job.id),
  );
  const recovered = await Promise.all(missing.map((job) => read(job.id)));
  return isCurrent() ? mergeSummaries(history, recovered) : history;
}

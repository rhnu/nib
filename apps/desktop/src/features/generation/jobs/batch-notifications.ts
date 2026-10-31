import type { JobSummary } from "@/bindings/generation";

export type BatchNotice = { id: string; failed: boolean; count: number };

/** Observe active work only; opening history never replays old completion notifications. */
export class BatchNotifications {
  private batches = new Map<string, Map<string, JobSummary>>();

  private finished = new Set<string>();

  track(jobs: readonly JobSummary[]) {
    for (const job of jobs) {
      if (
        (job.status === "queued" || job.status === "running") &&
        !this.finished.has(job.batchId)
      ) {
        if (!this.batches.has(job.batchId)) this.batches.set(job.batchId, new Map());
        this.batches.get(job.batchId)!.set(job.id, job);
      }
    }
  }

  update(jobs: readonly JobSummary[]): BatchNotice[] {
    this.track(jobs);
    for (const job of jobs) this.batches.get(job.batchId)?.set(job.id, job);
    const notices: BatchNotice[] = [];
    for (const [id, records] of this.batches) {
      const batch = [...records.values()];
      if (
        batch.length < batch[0]!.requestCount ||
        batch.some((job) => job.status === "queued" || job.status === "running")
      )
        continue;
      this.batches.delete(id);
      this.finished.add(id);
      if (!batch.every((job) => job.status === "cancelled"))
        notices.push({
          id,
          count: batch.length,
          failed: batch.some((job) => job.status === "failed" || job.status === "interrupted"),
        });
    }
    return notices;
  }
}

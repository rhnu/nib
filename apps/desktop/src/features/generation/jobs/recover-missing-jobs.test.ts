import { describe, expect, it } from "vitest";
import type { JobSummary } from "@/bindings/generation";
import { refreshHistory } from "./paged-history";
import { recoverMissingJobs } from "./recover-missing-jobs";
import { reconcileJobs } from "./summary";
function job(id: string, status: JobSummary["status"], submittedAt = 1): JobSummary {
  return {
    id,
    batchId: id,
    requestIndex: 0,
    requestCount: 1,
    retryOfJobId: null,
    credentialId: "account",
    status,
    submittedAt,
    finishedAt: null,
    error: null,
    resultIds: [],
    operation: { kind: "upscale", assetId: "source" },
    execution: { imageBaseUrl: null, imageRequestEncoding: "json", serverImageCache: false },
    observation: null,
  };
}
describe("recovering tasks after missed terminal feedback", () => {
  it("retains an old active task when a known newer history head hides its completion", async () => {
    const previousActive = job("old-running", "running");
    const knownHead = job("known-newer", "completed", 100);
    const history = await refreshHistory(
      { items: [knownHead], nextCursor: "100" },
      { items: [knownHead], nextCursor: "100" },
      async () => {
        throw new Error("known head must stop history reads");
      },
      () => true,
    );
    const reads: string[] = [];
    const terminal = await recoverMissingJobs(
      [previousActive],
      [],
      history.items,
      async (id) => {
        reads.push(id);
        return job(id, "completed");
      },
      () => true,
    );
    expect(reads).toEqual(["old-running"]);
    expect(
      reconcileJobs([], terminal, [previousActive, knownHead]).map(({ id, status }) => [
        id,
        status,
      ]),
    ).toEqual([
      ["known-newer", "completed"],
      ["old-running", "completed"],
    ]);
  });
  it("reads only missing previous active identities and preserves the latest active collection", async () => {
    const active = job("still-running", "running");
    const ended = job("ended", "completed");
    const previous = [
      active,
      job("ended", "queued"),
      job("missing", "running"),
      job("old", "failed"),
    ];
    const reads: string[] = [];
    const history = await recoverMissingJobs(
      previous,
      [active],
      [ended],
      async (id) => {
        reads.push(id);
        return job(id, "cancelled");
      },
      () => true,
    );
    expect(reads).toEqual(["missing"]);
    expect(history.map(({ id, status }) => [id, status])).toEqual([
      ["ended", "completed"],
      ["missing", "cancelled"],
    ]);
    expect(reconcileJobs([active], history, previous)[0]).toBe(active);
  });
  it("does not turn a failed targeted read into disappearance or a fabricated terminal record", async () => {
    const previous = [job("running", "running")];
    await expect(
      recoverMissingJobs(
        previous,
        [],
        [],
        async () => {
          throw new Error("storage unavailable");
        },
        () => true,
      ),
    ).rejects.toThrow("storage unavailable");
    expect(previous[0].status).toBe("running");
  });
  it("does not start targeted reads for an obsolete refresh", async () => {
    const history = [job("known", "completed")];
    const result = await recoverMissingJobs(
      [job("running", "running")],
      [],
      history,
      async () => {
        throw new Error("obsolete refresh must not read");
      },
      () => false,
    );
    expect(result).toBe(history);
  });
  it("discards a targeted response when a newer mutation takes ownership", async () => {
    let current = true;
    const history: JobSummary[] = [];
    const result = await recoverMissingJobs(
      [job("old", "running")],
      [],
      history,
      async (id) => {
        current = false;
        return job(id, "completed");
      },
      () => current,
    );
    expect(result).toBe(history);
  });
});

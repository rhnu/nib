import { describe, expect, it } from "vitest";
import type { JobSummary } from "../../../bindings/generation";
import { mergeSummaries, reconcileJobs } from "./summary";
function job(id: string, status: JobSummary["status"]): JobSummary {
  return {
    id,
    batchId: id,
    requestIndex: 0,
    requestCount: 1,
    retryOfJobId: null,
    credentialId: "account",
    status,
    submittedAt: 1,
    finishedAt: null,
    error: null,
    resultIds: [],
    operation: { kind: "upscale", assetId: "image" },
    execution: { imageBaseUrl: null, imageRequestEncoding: "json", serverImageCache: false },
    observation: null,
  };
}
describe("paged generation history", () => {
  it("replaces overlapping head records while retaining already loaded older pages", () => {
    const old = { id: "old", available: true };
    const replaced = { id: "head", available: false };
    expect(mergeSummaries([replaced], [{ id: "head", available: true }, old])).toEqual([
      replaced,
      old,
    ]);
  });
  it("removes a no longer active job and keeps its terminal record only once", () => {
    const running = job("active", "running");
    const finished = job("done", "completed");
    const historical = job("old", "failed");
    const result = reconcileJobs([running], [finished], [job("done", "running"), historical]);
    expect(result.map(({ id, status }) => [id, status])).toEqual([
      ["active", "running"],
      ["done", "completed"],
      ["old", "failed"],
    ]);
  });
  it("retains a targeted terminal update outside the head in submission order", () => {
    const head = { ...job("new", "completed"), submittedAt: 30 };
    const loaded = { ...job("middle", "failed"), submittedAt: 20 };
    const targeted = { ...job("old-active", "completed"), submittedAt: 10 };
    expect(reconcileJobs([], [head], [targeted, loaded]).map((item) => item.id)).toEqual([
      "new",
      "middle",
      "old-active",
    ]);
  });
  it("does not retain a missing active job as a permanent history record", () => {
    expect(reconcileJobs([], [], [job("stale", "queued")])).toEqual([]);
  });
});

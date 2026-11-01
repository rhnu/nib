import { describe, expect, it } from "vitest";
import type { JobSummary, JobStatus } from "@/bindings/generation";
import { workStatus, workBatch } from "./work-state";

const job = (status: JobStatus, kind: "generation" | "director" = "generation") =>
  ({
    status,
    operation:
      kind === "generation"
        ? { kind, sampleCount: 1, sourceAssetId: null }
        : { kind, tool: "lineart", assetId: "image" },
  }) as Pick<JobSummary, "status" | "operation">;

describe("submission work state", () => {
  it("locks immediately and keeps the other entry available", () => {
    expect(workStatus(null, "create", false)).toBe("loading");
    expect(workStatus([], "create", true)).toBe("submitting");
    expect(workStatus([job("running")], "director", false)).toBe("idle");
  });
  it("waits for the remaining requests after one request finishes", () => {
    expect(workStatus([job("completed"), job("queued")], "create", false)).toBe("queued");
    expect(workStatus([job("running"), job("queued")], "create", false)).toBe("running");
  });
  it("releases all terminal outcomes", () => {
    expect(
      workStatus(
        [job("completed"), job("failed"), job("cancelled"), job("interrupted")],
        "create",
        false,
      ),
    ).toBe("idle");
    expect(workStatus([job("running", "director")], "director", false)).toBe("running");
  });
});

describe("batch stop availability", () => {
  const request = (id: string, status: JobStatus, requestIndex: number, batchId = "batch") =>
    ({
      ...job(status),
      id,
      batchId,
      requestIndex,
      requestCount: 3,
      submittedAt: 1,
    }) as JobSummary;

  it("only offers stopping while the selected entry has queued requests", () => {
    expect(workBatch(null, "create")).toBeNull();
    expect(workBatch([request("1", "completed", 0)], "create")).toBeNull();
    const requests = [request("1", "running", 0), request("2", "queued", 1)];
    expect(workBatch(requests, "director")).toBeNull();
    expect(workBatch(requests, "create")).toMatchObject({ queued: 1, finishing: false });
    expect(
      workBatch([request("1", "running", 0), request("2", "cancelled", 1)], "create"),
    ).toMatchObject({ queued: 0, finishing: true });
    expect(
      workBatch([request("1", "completed", 0), request("2", "running", 1)], "create"),
    ).toMatchObject({ queued: 0, finishing: false });
  });

  it("keeps the latest batch separate from older running work", () => {
    const requests = [request("1", "running", 0, "old"), request("10", "queued", 0, "new")];
    expect(workBatch(requests, "create")).toMatchObject({ id: "new", queued: 1 });
    expect(workBatch(requests, "create")?.running).toBeUndefined();
  });
});

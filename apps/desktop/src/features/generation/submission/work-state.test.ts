import { describe, expect, it } from "vitest";
import type { JobSummary, JobStatus } from "@/bindings/generation";
import { workStatus } from "./work-state";

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

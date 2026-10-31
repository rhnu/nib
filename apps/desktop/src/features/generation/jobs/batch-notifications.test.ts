import { describe, expect, it } from "vitest";
import type { JobStatus, JobSummary } from "@/bindings/generation";
import { BatchNotifications } from "./batch-notifications";

const job = (id: string, status: JobStatus, requestCount = 2) =>
  ({ id, status, batchId: "batch", requestCount }) as JobSummary;

describe("batch notifications", () => {
  it("ignores existing terminal history", () => {
    expect(new BatchNotifications().update([job("old", "completed", 1)])).toEqual([]);
  });
  it("waits for all requests, retains observations across pages, and notifies once", () => {
    const notices = new BatchNotifications();
    notices.update([job("a", "running"), job("b", "queued")]);
    expect(notices.update([job("a", "completed"), job("b", "running")])).toEqual([]);
    expect(notices.update([job("b", "failed")])).toEqual([{ id: "batch", failed: true, count: 2 }]);
    expect(notices.update([job("a", "completed"), job("b", "failed")])).toEqual([]);
  });
  it("tracks returned submissions before a fast completion snapshot", () => {
    const notices = new BatchNotifications();
    notices.track([job("a", "queued", 1)]);
    expect(notices.update([job("a", "completed", 1)])).toEqual([
      { id: "batch", failed: false, count: 1 },
    ]);
  });
  it("does not announce a fully cancelled batch", () => {
    const notices = new BatchNotifications();
    notices.update([job("a", "queued", 1)]);
    expect(notices.update([job("a", "cancelled", 1)])).toEqual([]);
  });
});

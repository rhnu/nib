import { describe, expect, it } from "vitest";
import { settlementSummary } from "./job-observation";

describe("request settlement display", () => {
  it("keeps encoding completion separate from image counts", () => {
    const encoded = settlementSummary({ kind: "succeeded", imageCount: 0 }, "encodeVibe");
    expect(settlementSummary({ kind: "succeeded", imageCount: 2 }, "encodeVibe")).toBe(encoded);
    const generated = settlementSummary({ kind: "succeeded", imageCount: 2 }, "generation");
    expect(generated).toContain("2");
    expect(generated).not.toBe(encoded);
  });

  it("retains HTTP status and readable error classification", () => {
    const rejected = settlementSummary(
      { kind: "failed", failure: "api", httpStatus: null },
      "generation",
    );
    expect(
      settlementSummary({ kind: "failed", failure: "api", httpStatus: 429 }, "generation"),
    ).toBe(`${rejected} · HTTP 429`);
    const unknown = settlementSummary(
      { kind: "failed", failure: "futureCategory", httpStatus: null },
      "generation",
    );
    expect(unknown).toBeTruthy();
    expect(rejected).not.toBe(unknown);
    expect(
      settlementSummary({ kind: "failed", failure: "stream", httpStatus: null }, "generation"),
    ).not.toBe(unknown);
  });
});

import { describe, expect, it } from "vitest";
import { settlementSummary } from "./job-observation";

describe("request settlement display", () => {
  it("keeps encoding completion separate from image counts", () => {
    expect(settlementSummary({ kind: "succeeded", imageCount: 0 }, "encodeVibe")).toBe(
      "编码请求成功",
    );
    expect(settlementSummary({ kind: "succeeded", imageCount: 2 }, "generation")).toBe(
      "请求成功 · 2 个图像产出",
    );
  });
  it("retains HTTP status and readable error classification", () => {
    expect(
      settlementSummary({ kind: "failed", failure: "api", httpStatus: 429 }, "generation"),
    ).toBe("服务端拒绝请求 · HTTP 429");
    expect(
      settlementSummary(
        { kind: "failed", failure: "futureCategory", httpStatus: null },
        "generation",
      ),
    ).toBe("请求失败");
    expect(
      settlementSummary({ kind: "failed", failure: "stream", httpStatus: null }, "generation"),
    ).toContain("不完整");
  });
});

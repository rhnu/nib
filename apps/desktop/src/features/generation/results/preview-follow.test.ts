import { describe, expect, it } from "vitest";
import type { FeedbackSample } from "../jobs/feedback-state";
import { nextPreviewJob } from "./preview-follow";

function job(id: string, requestIndex: number, resultIds: string[] = []) {
  return {
    id,
    batchId: "batch",
    requestIndex,
    resultIds,
    operation: { kind: "upscale" as const, assetId: "source" },
  };
}

function frame(bytes: Uint8Array<ArrayBuffer> | null): FeedbackSample {
  return { sampleIndex: 1, stepIndex: 0, bytes, mimeType: "image/jpeg", finalReceived: false };
}

describe("batch preview following", () => {
  const first = job("first", 0, ["first-image"]);
  const second = job("second", 1);

  it("keeps the preceding request selected while the next request has no image", () => {
    const receipt: FeedbackSample = { ...frame(null), finalReceived: true };
    expect(nextPreviewJob([first, second], {}, "batch", first.id)).toBeNull();
    expect(nextPreviewJob([first, second], { second: [receipt] }, "batch", first.id)).toBeNull();
  });

  it("follows the next request when any sample's first preview arrives", () => {
    expect(
      nextPreviewJob([first, second], { second: [frame(new Uint8Array([1]))] }, "batch", first.id),
    ).toBe(second.id);
  });

  it("follows a saved result when the request has no streamed preview", () => {
    expect(
      nextPreviewJob([first, { ...second, resultIds: ["second-image"] }], {}, "batch", first.id),
    ).toBe(second.id);
  });

  it("does not repeat a switch or move backwards when frames are released", () => {
    const jobs = [first, second];
    expect(
      nextPreviewJob(jobs, { second: [frame(new Uint8Array([1]))] }, "batch", second.id),
    ).toBeNull();
    expect(nextPreviewJob(jobs, {}, "batch", second.id)).toBeNull();
  });

  it("chooses the latest ready request and skips requests without an image", () => {
    const third = job("third", 2, ["third-image"]);
    const fourth = job("fourth", 3);
    expect(nextPreviewJob([fourth, third, second, first], {}, "batch", first.id)).toBe(third.id);
  });

  it("ignores other batches and encoding results", () => {
    const other = { ...second, batchId: "other", resultIds: ["other-image"] };
    const encoding = {
      ...second,
      resultIds: ["encoded-material"],
      operation: { kind: "encodeVibe" as const },
    };
    expect(nextPreviewJob([first, other], {}, "batch", first.id)).toBeNull();
    expect(nextPreviewJob([first, encoding], {}, "batch", first.id)).toBeNull();
    expect(nextPreviewJob([first], {}, null, null)).toBeNull();
  });
});

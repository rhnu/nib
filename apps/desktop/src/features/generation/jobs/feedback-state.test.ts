import { describe, expect, it } from "vitest";
import type { JobFeedback } from "../../../bindings/generation";
import {
  emptyFeedback,
  feedbackLimits,
  finishFeedback,
  jobFeedbackText,
  receiveFeedback,
  reconcileFeedback,
  releaseFeedbackFrame,
  type FeedbackJob,
} from "./feedback-state";

function preview(
  jobId = "a",
  sampleIndex = 0,
  stepIndex = 0,
): Extract<JobFeedback, { kind: "preview" }> {
  return {
    kind: "preview",
    jobId,
    sampleIndex,
    stepIndex,
    mimeType: "image/jpeg",
    imageBytes: [1, 2, 3],
  };
}

const job: FeedbackJob = {
  id: "a",
  status: "running",
  operation: { kind: "upscale", assetId: "source" },
};

describe("transient task feedback", () => {
  it("keeps task/sample identities separate and replaces only newer steps", () => {
    let state = receiveFeedback(emptyFeedback, preview(), []);
    state = receiveFeedback(state, preview("a", 1, 2), []);
    state = receiveFeedback(state, preview("b", 0, 9), []);
    state = receiveFeedback(state, preview("a", 0, 3), []);
    expect(state.samples.a?.map((sample) => [sample.sampleIndex, sample.stepIndex])).toEqual([
      [1, 2],
      [0, 3],
    ]);
    expect(state.samples.b?.[0]?.stepIndex).toBe(9);
    expect(receiveFeedback(state, preview("a", 0, 2), [])).toBe(state);
  });

  it("records receipt without claiming completion and blocks late preview frames", () => {
    let state = receiveFeedback(emptyFeedback, preview(), [job]);
    state = receiveFeedback(state, { kind: "finalReceived", jobId: "a", sampleIndex: 0 }, [job]);
    expect(state.samples.a?.[0]?.finalReceived).toBe(true);
    expect(jobFeedbackText(job, state.samples.a)).toContain("等待任务完成与保存");
    expect(receiveFeedback(state, preview("a", 0, 100), [job])).toBe(state);
    state = finishFeedback(state, "a");
    expect(state.samples.a?.[0]?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(receiveFeedback(state, preview("a", 0, 101), [job])).toBe(state);
    state = releaseFeedbackFrame(state, "a", 0);
    expect(state.samples.a).toBeUndefined();
  });

  it("clears terminal tasks from durable queries and suppresses stale delivery", () => {
    const terminal = { ...job, status: "failed" as const };
    let state = receiveFeedback(emptyFeedback, preview(), [job]);
    state = reconcileFeedback(state, [terminal]);
    expect(state.samples).toEqual({});
    expect(receiveFeedback(emptyFeedback, preview(), [terminal])).toBe(emptyFeedback);
    expect(jobFeedbackText(terminal)).toBe("失败");
  });

  it("discards frames on a subscription gap without losing terminal suppression", () => {
    let state = finishFeedback(emptyFeedback, "ended");
    state = receiveFeedback(state, preview(), []);
    state = receiveFeedback(state, { kind: "resyncRequired" }, []);
    expect(state.samples).toEqual({});
    expect(receiveFeedback(state, preview("ended"), [])).toBe(state);
  });

  it("projects running observations and releases them when durable completion takes over", () => {
    const observation = { requestId: 5, estimatedAnlas: 3, outcome: null, account: null };
    let state = receiveFeedback(emptyFeedback, { kind: "observation", jobId: "a", observation }, [
      job,
    ]);
    expect(state.observations.a).toBe(observation);
    state = receiveFeedback(
      state,
      {
        kind: "observation",
        jobId: "a",
        observation: { ...observation, outcome: { kind: "succeeded", imageCount: 1 } },
      },
      [job],
    );
    expect(state.observations.a?.outcome?.kind).toBe("succeeded");
    state = reconcileFeedback(state, [{ ...job, status: "completed" }]);
    expect(state.observations).toEqual({});
    expect(receiveFeedback(state, { kind: "observation", jobId: "a", observation }, [job])).toBe(
      state,
    );
  });

  it("bounds sample retention and rejects unusable or oversized frames", () => {
    let state = emptyFeedback;
    for (let index = 0; index < feedbackLimits.samples + 3; index += 1)
      state = receiveFeedback(state, preview("a", index), []);
    expect(state.samples.a).toHaveLength(feedbackLimits.samples);
    expect(state.samples.a?.[0]?.sampleIndex).toBe(3);
    expect(receiveFeedback(state, { ...preview(), mimeType: null }, [])).toBe(state);
    expect(receiveFeedback(state, preview("a", -1), [])).toBe(state);
    expect(
      receiveFeedback(
        state,
        { ...preview(), imageBytes: new Array<number>(feedbackLimits.frameBytes + 1) },
        [],
      ),
    ).toBe(state);
  });

  it("enforces the shared byte budget across task/sample frames", () => {
    const bytes = new Array<number>(feedbackLimits.frameBytes).fill(1);
    let state = emptyFeedback;
    for (let index = 0; index < 5; index += 1)
      state = receiveFeedback(state, { ...preview("a", index), imageBytes: bytes }, []);
    expect(state.samples.a?.map((sample) => sample.sampleIndex)).toEqual([1, 2, 3, 4]);
  });
});

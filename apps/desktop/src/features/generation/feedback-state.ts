import type { JobFeedback, JobObservation, JobRecord, JobStatus } from "../../bindings/generation";

export type FeedbackSample = {
  sampleIndex: number;
  stepIndex: number | null;
  bytes: Uint8Array<ArrayBuffer> | null;
  mimeType: string;
  finalReceived: boolean;
};

export type FeedbackState = {
  samples: Record<string, FeedbackSample[]>;
  observations: Record<string, JobObservation>;
  finishedIds: string[];
};

export const emptyFeedback: FeedbackState = { samples: {}, observations: {}, finishedIds: [] };
export const feedbackLimits = {
  frameBytes: 8 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  samples: 16,
};
export type FeedbackJob = Pick<JobRecord, "id" | "status" | "submission">;

export function isTerminal(status: JobStatus) {
  return status !== "queued" && status !== "running";
}

/** Keep only the latest frame for each task/sample, with a single window memory budget. */
export function receiveFeedback(
  state: FeedbackState,
  event: JobFeedback,
  jobs: readonly FeedbackJob[],
): FeedbackState {
  if (event.kind === "resyncRequired") return { ...state, samples: {}, observations: {} };
  if (event.kind === "finished") return finishFeedback(state, event.jobId);
  if (event.kind === "started") return state;
  const job = jobs.find((value) => value.id === event.jobId);
  if (state.finishedIds.includes(event.jobId) || (job && isTerminal(job.status))) return state;
  if (event.kind === "observation") {
    const observations = { ...state.observations };
    delete observations[event.jobId];
    observations[event.jobId] = event.observation;
    return { ...state, observations: Object.fromEntries(Object.entries(observations).slice(-16)) };
  }
  if (!Number.isInteger(event.sampleIndex) || event.sampleIndex < 0) return state;
  if (
    job?.submission.kind === "generation" &&
    event.sampleIndex >= job.submission.resolved.settings.nSamples
  )
    return state;
  const previous = state.samples[event.jobId]?.find(
    (sample) => sample.sampleIndex === event.sampleIndex,
  );
  if (event.kind === "preview") {
    if (previous?.finalReceived || !Number.isInteger(event.stepIndex) || event.stepIndex < 0)
      return state;
    if (
      previous?.stepIndex !== null &&
      previous?.stepIndex !== undefined &&
      event.stepIndex <= previous.stepIndex
    )
      return state;
    if (
      !event.mimeType ||
      !event.imageBytes.length ||
      event.imageBytes.length > feedbackLimits.frameBytes
    )
      return state;
  }
  const next: FeedbackSample =
    event.kind === "preview"
      ? {
          sampleIndex: event.sampleIndex,
          stepIndex: event.stepIndex,
          bytes: new Uint8Array(event.imageBytes),
          mimeType: event.mimeType!,
          finalReceived: false,
        }
      : {
          sampleIndex: event.sampleIndex,
          stepIndex: previous?.stepIndex ?? null,
          bytes: previous?.bytes ?? null,
          mimeType: previous?.mimeType ?? "image/jpeg",
          finalReceived: true,
        };
  const entries = Object.entries(state.samples)
    .flatMap(([jobId, samples]) => samples.map((sample) => ({ jobId, sample })))
    .filter(
      ({ jobId, sample }) => jobId !== event.jobId || sample.sampleIndex !== event.sampleIndex,
    );
  entries.push({ jobId: event.jobId, sample: next });
  let bytes = entries.reduce((sum, entry) => sum + (entry.sample.bytes?.byteLength ?? 0), 0);
  while (entries.length > feedbackLimits.samples || bytes > feedbackLimits.totalBytes) {
    bytes -= entries.shift()!.sample.bytes?.byteLength ?? 0;
  }
  const samples: FeedbackState["samples"] = {};
  for (const entry of entries) (samples[entry.jobId] ??= []).push(entry.sample);
  return { ...state, samples };
}

export function finishFeedback(state: FeedbackState, jobId: string): FeedbackState {
  if (!state.samples[jobId] && !state.observations[jobId] && state.finishedIds.includes(jobId))
    return state;
  const samples = { ...state.samples };
  const observations = { ...state.observations };
  delete samples[jobId];
  delete observations[jobId];
  return {
    samples,
    observations,
    finishedIds: [...state.finishedIds.filter((id) => id !== jobId), jobId].slice(-128),
  };
}

export function reconcileFeedback(state: FeedbackState, jobs: readonly FeedbackJob[]) {
  return jobs.reduce(
    (next, job) =>
      isTerminal(job.status) && (next.samples[job.id] || next.observations[job.id])
        ? finishFeedback(next, job.id)
        : next,
    state,
  );
}

export function jobFeedbackText(
  job: Pick<JobRecord, "status">,
  samples: readonly FeedbackSample[] = [],
) {
  if (job.status === "queued") return "排队中";
  if (job.status === "running") {
    const received = samples.filter((sample) => sample.finalReceived).length;
    if (received) return `已接收 ${received} 个最终样本 · 等待任务完成与保存`;
    const preview = samples.filter((sample) => sample.stepIndex !== null).at(-1);
    return preview
      ? `样本 ${preview.sampleIndex + 1} · 步骤 ${preview.stepIndex}`
      : "执行中 · 等待返回";
  }
  return { completed: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断" }[
    job.status
  ];
}

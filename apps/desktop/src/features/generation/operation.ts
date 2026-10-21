import type { FrozenSubmission } from "../../bindings/generation";

export function submissionLabel(submission: FrozenSubmission): string {
  if (submission.kind === "generation") return submission.resolved.settings.model;
  if (submission.kind === "encodeVibe") return `Vibe 编码 · ${submission.model}`;
  const command = submission.command;
  if (typeof command !== "string") return "emotion" in command ? "情绪处理" : "着色";
  return { lineart: "描线", sketch: "草图", bg_removal: "去背景", declutter: "清理" }[command];
}

import type { FrozenSubmission } from "@/bindings/generation";

export function submissionLabel(submission: FrozenSubmission): string {
  if (submission.kind === "generation") return submission.resolved.settings.model;
  if (submission.kind === "encodeVibe") return `氛围转移编码 · ${submission.model}`;
  if (submission.kind === "upscale") return `放大 · ${submission.model}`;
  const command = submission.command;
  if (typeof command !== "string") return "emotion" in command ? "情绪处理" : "着色";
  return {
    lineart: "描线",
    sketch: "草图",
    bg_removal: "去背景",
    declutter: "清理",
    declutter_keep_bubbles: "清理并保留气泡",
  }[command];
}

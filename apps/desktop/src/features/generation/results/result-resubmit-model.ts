import type { Draft } from "@/bindings/workbench";
import type { GenerationResult } from "@/bindings/generation";
import { directorSubmission } from "@/features/director/model";

/** Restored Director editing state must become an explicit paid operation before quoting. */
export function prepareResubmission(
  restored: Draft,
  kind: GenerationResult["submission"]["kind"],
): Draft {
  if (kind !== "director") return restored;
  const submission = directorSubmission(restored);
  if (!submission) throw new Error("导演工具结果缺少可重新提交的输入。");
  return submission;
}

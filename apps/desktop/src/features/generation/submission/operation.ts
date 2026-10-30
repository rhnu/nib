import { t } from "@/shared/i18n";
import type { FrozenSubmission } from "@/bindings/generation";

export function submissionLabel(submission: FrozenSubmission): string {
  if (submission.kind === "generation") return submission.resolved.settings.model;
  if (submission.kind === "encodeVibe")
    return t("generation.vibeEncodingLabel", { value0: submission.model });
  if (submission.kind === "upscale")
    return t("generation.upscaleLabel", { value0: submission.model });
  const command = submission.command;
  if (typeof command !== "string")
    return "emotion" in command ? t("generation.emotion") : t("generation.colorize");
  return {
    lineart: t("generation.lineArt"),
    sketch: t("generation.sketch"),
    bg_removal: t("generation.removeBackground"),
    declutter: t("generation.declutter"),
    declutter_keep_bubbles: t("generation.declutterKeepBubbles"),
  }[command];
}

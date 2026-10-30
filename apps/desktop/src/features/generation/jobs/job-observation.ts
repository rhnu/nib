import { t } from "@/shared/i18n";
import type { FrozenSubmission, RequestSettlement } from "@/bindings/generation";

const failureLabels: Record<string, string> = {
  get stream() {
    return t("generation.incompleteStream");
  },
  get invalidRequest() {
    return t("generation.invalidParameters");
  },
  get preparation() {
    return t("generation.requestPreparationFailed");
  },
  get api() {
    return t("generation.requestRejected");
  },
  get transport() {
    return t("generation.networkFailed");
  },
  get encode() {
    return t("generation.encodingFailed");
  },
  get decode() {
    return t("generation.decodingFailed");
  },
  get metadata() {
    return t("generation.metadataFailed");
  },
};

export function settlementSummary(
  outcome: RequestSettlement | null,
  kind: FrozenSubmission["kind"],
) {
  if (!outcome) return t("generation.awaitingFinalState");
  if (outcome.kind === "cancelled") return t("generation.requestCancelled");
  if (outcome.kind === "succeeded") {
    if (kind === "encodeVibe") return t("generation.encodingSucceeded");
    return outcome.imageCount
      ? t("generation.requestOutputCount", { count: outcome.imageCount })
      : t("generation.requestSucceeded");
  }
  return `${failureLabels[outcome.failure] ?? t("generation.requestFailed")}${outcome.httpStatus === null ? "" : ` · HTTP ${outcome.httpStatus}`}`;
}

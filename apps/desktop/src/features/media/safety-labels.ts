import { t } from "@/shared/i18n";

/** Application reason codes are localized; model and platform diagnostics retain their details. */
export function safetyReason(reason: string) {
  switch (reason) {
    case "notScanned":
      return t("safety.reason_notScanned");
    case "autoScanDisabled":
      return t("safety.reason_autoScanDisabled");
    case "modelUnavailable":
      return t("safety.reason_modelUnavailable");
    case "modelRevisionMismatch":
      return t("safety.reason_modelRevisionMismatch");
    default:
      return reason;
  }
}

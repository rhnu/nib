import type { ExploreError, ExploreSource } from "@/bindings/explore";
import { errorMessage, t } from "@/shared/i18n";

const errorKeys = {
  invalidQuery: "explore.error_invalidQuery",
  staleIdentity: "explore.error_staleIdentity",
  unauthorized: "explore.error_unauthorized",
  forbidden: "explore.error_forbidden",
  notFound: "explore.error_notFound",
  rateLimited: "explore.error_rateLimited",
  unavailable: "explore.error_unavailable",
  invalidResponse: "explore.error_invalidResponse",
  mediaRejected: "explore.error_mediaRejected",
} as const;

export function exploreErrorMessage(error: unknown, source: ExploreSource = "danbooru") {
  if (
    error &&
    typeof error === "object" &&
    "kind" in error &&
    typeof error.kind === "string" &&
    error.kind in errorKeys
  ) {
    const remote = error as ExploreError;
    const message =
      source === "novelAi" && (remote.kind === "unauthorized" || remote.kind === "forbidden")
        ? t("explore.publicAccessRejected")
        : t(errorKeys[remote.kind]);
    return remote.retryAfterSeconds
      ? `${message} ${t("explore.retryAfter", { seconds: remote.retryAfterSeconds })}`
      : message;
  }
  return errorMessage(error);
}

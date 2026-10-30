import { t, MessageError, deferMessage } from "@/shared/i18n";
import { createContext, useContext } from "react";
import type { useJobFeedback } from "./use-job-feedback";

export const FeedbackContext = createContext<ReturnType<typeof useJobFeedback> | null>(null);

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new MessageError(deferMessage(() => t("generation.feedbackProviderRequired")));
  return value;
}

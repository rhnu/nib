import { createContext, useContext } from "react";
import type { useJobFeedback } from "./use-job-feedback";

export const FeedbackContext = createContext<ReturnType<typeof useJobFeedback> | null>(null);

export function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("反馈组件需要位于 GenerationProvider 内。");
  return value;
}

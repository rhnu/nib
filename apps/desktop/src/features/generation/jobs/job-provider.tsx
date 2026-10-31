import { JobNotifications } from "./job-notifications";
import type { ReactNode } from "react";
import { JobContext, useJobData } from "./job-context";
import { FeedbackContext } from "./feedback-context";
import { useJobQuery } from "./use-job-query";
import { useJobFeedback } from "./use-job-feedback";

function FeedbackProvider({ children }: { children: ReactNode }) {
  const { jobs, refresh, refreshJob } = useJobData();
  const feedback = useJobFeedback(jobs, refresh, refreshJob);
  return <FeedbackContext value={feedback}>{children}</FeedbackContext>;
}

export function JobProvider({ children }: { children: ReactNode }) {
  const data = useJobQuery();
  return (
    <JobContext value={data}>
      <JobNotifications />
      <FeedbackProvider>{children}</FeedbackProvider>
    </JobContext>
  );
}

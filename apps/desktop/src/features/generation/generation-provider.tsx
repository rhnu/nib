import type { ReactNode } from "react";
import { SubmissionProvider } from "./submission/submission-provider";
import { JobProvider } from "./jobs/job-provider";
import "./generation.css";
/** Each lifecycle owns its updates; preview frames do not invalidate account or durable queries. */
export function GenerationProvider({
  children,
  beforeSubmit,
  submissionBlocked = false,
}: {
  children: ReactNode;
  beforeSubmit?: () => Promise<void>;
  submissionBlocked?: boolean;
}) {
  return (
    <SubmissionProvider beforeSubmit={beforeSubmit} submissionBlocked={submissionBlocked}>
      <JobProvider>{children}</JobProvider>
    </SubmissionProvider>
  );
}

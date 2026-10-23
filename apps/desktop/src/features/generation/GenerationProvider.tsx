import type { ReactNode } from "react";
import { SubmissionProvider } from "./submission/SubmissionProvider";
import { JobProvider } from "./jobs/JobProvider";
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

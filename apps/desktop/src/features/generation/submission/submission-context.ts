import { t, MessageError, deferMessage } from "@/shared/i18n";
import { createContext, useContext } from "react";
import type { Draft } from "@/bindings/workbench";
import type { GenerationBatch } from "@/bindings/generation";

import type { SubmissionOrigin, WorkStatus } from "./work-state";

export type SubmissionContextValue = {
  submit: (draft: Draft) => Promise<GenerationBatch>;
  submissionBlocked: boolean;
  work: Record<SubmissionOrigin, WorkStatus>;
};
export const SubmissionContext = createContext<SubmissionContextValue | null>(null);

export function useSubmission() {
  const value = useContext(SubmissionContext);
  if (!value)
    throw new MessageError(deferMessage(() => t("generation.submissionProviderRequired")));
  return value;
}

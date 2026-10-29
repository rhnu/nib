import { createContext, useContext } from "react";
import type { Draft } from "../../../bindings/workbench";
import type { GenerationBatch } from "../../../bindings/generation";
export type SubmissionContextValue = {
  submit: (draft: Draft) => Promise<GenerationBatch>;
  submissionBlocked: boolean;
};
export const SubmissionContext = createContext<SubmissionContextValue | null>(null);
export function useSubmission() {
  const value = useContext(SubmissionContext);
  if (!value) throw new Error("提交组件需要位于 GenerationProvider 内。");
  return value;
}

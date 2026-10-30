import { createContext, useContext } from "react";
import type { useJobQuery } from "./use-job-query";

export const JobContext = createContext<ReturnType<typeof useJobQuery> | null>(null);

export function useJobData() {
  const value = useContext(JobContext);
  if (!value) throw new Error("任务组件需要位于 GenerationProvider 内。");
  return value;
}

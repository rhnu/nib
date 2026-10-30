import { t, MessageError, deferMessage } from "@/shared/i18n";
import { createContext, useContext } from "react";
import type { useJobQuery } from "./use-job-query";

export const JobContext = createContext<ReturnType<typeof useJobQuery> | null>(null);

export function useJobData() {
  const value = useContext(JobContext);
  if (!value) throw new MessageError(deferMessage(() => t("generation.taskProviderRequired")));
  return value;
}

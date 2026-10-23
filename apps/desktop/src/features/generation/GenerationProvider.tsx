import type { ReactNode } from "react";
import { GenerationContext } from "./generation-context";
import { useGenerationData } from "./use-generation-data";
import "./generation.css";

export function GenerationProvider({
  children,
  executionVersion = 0,
  beforeSubmit,
  submissionBlocked = false,
}: {
  children: ReactNode;
  executionVersion?: number;
  beforeSubmit?: () => Promise<void>;
  submissionBlocked?: boolean;
}) {
  const value = useGenerationData(executionVersion, beforeSubmit, submissionBlocked);
  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}

import type { ReactNode } from "react";
import { GenerationContext } from "./generation-context";
import { useGenerationData } from "./use-generation-data";
import "./generation.css";

export function GenerationProvider({ children }: { children: ReactNode }) {
  const value = useGenerationData();
  return <GenerationContext.Provider value={value}>{children}</GenerationContext.Provider>;
}
